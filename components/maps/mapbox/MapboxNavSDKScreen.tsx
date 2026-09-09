import React, { useCallback, useEffect, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  Linking,
  Platform,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'
import { useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import * as Location from 'expo-location'
import { CheckCircle2, PackageCheck } from 'lucide-react-native'
import { MapboxNavigationView } from '@badatgil/expo-mapbox-navigation'
import MapboxGL from '@rnmapbox/maps'

import api from '../../../lib/api/auth.api'
import {
  confirmTripPickup,
  confirmTripStop,
  completeBooking,
  endTripLeg,
  type StopProofContext,
} from '../../../lib/tripProgress'
import { buildNavPlan } from '../../../lib/navLegs'
import { SosButton } from '../../reports/SosButton'
import { fetchTripsWithCache, type Trip } from '../../../lib/trips'
import { saveBookingCache, loadBookingCache, clearBookingCache } from '../../../lib/navCache'
import { StopProofModal } from '../shared/StopProofModal'
import { groupCargoByDestination, manifestFor } from '../../../lib/cargoManifest'
import { legCoordinates } from '../../../lib/stopGeofence'
import { C } from '../../../theme/navigation.theme'

/**
 * Mapbox Navigation SDK drop-in turn-by-turn screen.
 *
 * Unlike the custom Mapbox stack (NavigationScreen*), this uses the real Mapbox
 * Navigation SDK via @badatgil/expo-mapbox-navigation. The native SDK owns
 * everything visual and behavioural — routing, road-snapping, voice, lane
 * guidance, the maneuver header, the ETA footer and automatic rerouting. Our
 * only jobs are:
 *   1. Feed it ordered coordinates from the backend (GET /booking/:id):
 *      [driver, (pickup if not yet picked up), ...pending drop-offs].
 *   2. Translate its arrival callbacks back into our booking status updates,
 *      mapping each arrival to a leg by order (the SDK exposes no waypoint id).
 *
 * As on the Google screen, the confirm button on the right of the map is a
 * FALLBACK for when the SDK's arrival detection doesn't fire (weak GPS, an
 * address the geofence can't reach). Both paths run the same confirmLeg(), so a
 * stop is recorded once either way. Marking the whole delivery done is always
 * the driver's tap — this SDK has no notion of the job being finished.
 *
 * The updates go through the durable offline queue so a confirmation made in a
 * dead zone is synced on reconnect (same as the Google path).
 */

interface Props {
  bookingId: string
  /**
   * The driver chose to run this booking ahead of its scheduled day. It has to
   * reach the pickup confirmation: the server refuses an early pickup that
   * doesn't declare itself, and records the override when it does.
   */
  earlyStart?: boolean
}

// The stop's own coordinates ride on the leg so the proof popup can measure the
// driver against it directly, rather than indexing into the parallel `coords`
// array (which is offset by the driver's own start point).
// A leg also names the RUN it belongs to: one vehicle may run a booking several
// times over, and two loads bound for the same bay are two different legs that
// only the trip stop id tells apart.
type Leg =
  | { type: 'pickup';  tripId: string; address?: string | null; latitude?: number | null; longitude?: number | null }
  | {
      type:          'dropoff'
      tripId:        string
      tripStopId:    string
      destinationId: string
      address?:      string | null
      latitude?:     number | null
      longitude?:    number | null
    }

const ANDROID = Platform.OS === 'android'
// The Android SDK wants the profile WITHOUT the `mapbox/` prefix; iOS wants it.
// Mapbox's Directions API caps `driving-traffic` at 3 coordinates per request,
// while `driving` allows up to 25. Multi-stop routes (driver + pickup + drops)
// routinely exceed 3 coords, so anything over that must use `driving` or the
// request is rejected and NOTHING renders — no route line and no waypoint pins
// (both come from the same native route-draw call).
const TRAFFIC_PROFILE = ANDROID ? 'driving-traffic' : 'mapbox/driving-traffic'
const PLAIN_PROFILE   = ANDROID ? 'driving'         : 'mapbox/driving'
const routeProfileFor = (coordCount: number) =>
  coordCount > 3 ? PLAIN_PROFILE : TRAFFIC_PROFILE

// How long after a stop is confirmed we disregard the SDK's own arrival
// detection (see onSdkArrival). Far shorter than any real drive between stops.
const RECENT_CONFIRM_IGNORE_MS = 5_000

MapboxGL.setAccessToken(process.env.EXPO_PUBLIC_MAPBOX_TOKEN ?? '')

export default function MapboxNavSDKScreen({ bookingId, earlyStart = false }: Props) {
  return (
    <NavErrorBoundary>
      <MapboxNavSDKInner bookingId={bookingId} earlyStart={earlyStart} />
    </NavErrorBoundary>
  )
}

function MapboxNavSDKInner({ bookingId, earlyStart = false }: Props) {
  const router = useRouter()
  const insets = useSafeAreaInsets()

  const [coordinates, setCoordinates] = useState<{ latitude: number; longitude: number }[] | null>(null)
  const [waypointIndices, setWaypointIndices] = useState<number[]>([])
  const [error, setError] = useState<string | null>(null)
  const [complete, setComplete] = useState(false)
  const [retry, setRetry] = useState(0)
  // Which leg the driver is confirming next, mirrored from cursorRef so the
  // button label re-renders. Separate from wherever the SDK's route has got to.
  const [cursor, setCursor] = useState(0)
  const [legCount, setLegCount] = useState(0)
  const [dropoffCount, setDropoffCount] = useState(0)
  // True once the SDK reports we've reached the stop the driver is on — a visual
  // cue only; it confirms nothing.
  const [atStop, setAtStop] = useState(false)
  // The stop whose proof popup is open, and whether it opened by itself (arrival
  // detected) or from the button. Null when the popup is closed.
  const [proofFor, setProofFor] = useState<{ idx: number; auto: boolean } | null>(null)

  const legsRef      = useRef<Leg[]>([])
  // The booking's runs, the booking itself and where the driver was when the
  // screen started — everything needed to rebuild the route for the NEXT run
  // when the current one empties.
  const tripsRef     = useRef<Trip[]>([])
  const bookingDataRef = useRef<any>(null)
  const driverStartRef = useRef<{ latitude: number; longitude: number } | null>(null)

  // Booking cargo grouped by destination, for the stop manifest.
  const cargoRef = useRef(groupCargoByDestination([]))

  /** The manifest for the drop-off a leg ends at; empty for the pickup leg. */
  const manifestForLeg = (leg: Leg | undefined) =>
    leg && leg.type === 'dropoff' ? manifestFor(cargoRef.current, leg.destinationId) : null
  const cursorRef    = useRef(0)
  const processedRef = useRef<Set<number>>(new Set())
  const completedRef = useRef(false)
  // When a stop was last confirmed — see onSdkArrival.
  const lastConfirmAtRef = useRef(0)

  /**
   * Build the route for the next run, or leave the booking ready to be closed.
   *
   * The shuttle's turning point: the truck has emptied this run's last bay and
   * drives back to the origin to load again. That is a fresh route from where
   * the driver now is, so the coordinate list is rebuilt from their current
   * position rather than continued from the one the SDK is holding.
   */
  const startNextTripIfAny = useCallback(async () => {
    endTripLeg()

    let trips = tripsRef.current
    try {
      const fresh = await fetchTripsWithCache(bookingId)
      trips = fresh.trips
      tripsRef.current = trips
    } catch { /* keep what we have — the local cursor drives the screen */ }

    const plan = buildNavPlan(bookingDataRef.current ?? {}, trips)
    if (!plan.trip || plan.nothingToNavigate || plan.legs.length === 0) return

    // Where the truck is NOW is the start of the run back to the origin. Falling
    // back to the original start point keeps a route on screen when the fix
    // fails, rather than dropping the driver into a blank map.
    let from = driverStartRef.current
    try {
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High })
      from = { latitude: pos.coords.latitude, longitude: pos.coords.longitude }
      driverStartRef.current = from
    } catch { /* keep the last known start */ }

    const legs   = plan.legs as Leg[]
    const coords = [
      ...(from ? [from] : []),
      ...legs.map((l) => ({ latitude: l.latitude as number, longitude: l.longitude as number })),
    ]

    legsRef.current      = legs
    cursorRef.current    = 0
    processedRef.current = new Set()
    setCursor(0)
    setLegCount(legs.length)
    setDropoffCount(legs.filter((l) => l.type === 'dropoff').length)
    setAtStop(false)
    setWaypointIndices(coords.map((_, i) => i))
    setCoordinates(coords)
  }, [bookingId])

  // Record a leg with the proof photo taken at it. The single write path: the
  // proof popup is the only caller, however it was opened. Idempotent — the
  // offline queue dedupes by id and processedRef makes a second call a no-op.
  const confirmLeg = useCallback((i: number, photoUri: string, proof: StopProofContext) => {
    const legs = legsRef.current
    if (i < 0 || i >= legs.length || processedRef.current.has(i)) return
    // Only ever confirm the stop we're actually on. Skipping one would leave a
    // drop-off unrecorded with no way back to it — and the backend won't let the
    // booking be completed while any drop-off is still pending. If an arrival
    // went undetected, the driver catches up with the button, in order.
    if (i !== cursorRef.current) return
    processedRef.current.add(i)
    lastConfirmAtRef.current = Date.now()
    const leg = legs[i]
    // Where the driver is headed next, so live tracking can tighten its update
    // cadence as the truck closes on that stop. Null on the last leg.
    const nextStop = legCoordinates(legs[i + 1])
    const persist = leg.type === 'pickup'
      ? confirmTripPickup(bookingId, leg.tripId, photoUri, earlyStart, proof, nextStop)
      : confirmTripStop(leg.tripStopId, photoUri, proof, nextStop)
    persist.catch(() => {})

    cursorRef.current = i + 1
    setCursor(i + 1)
    setAtStop(false)

    // Last bay of THIS RUN. On a shuttle the truck now drives back to the origin
    // to load again, which is a new route rather than a continuation — rebuild
    // against the next run. Position reporting stops for the empty leg back.
    //
    // Chained off `persist` rather than fired beside it: the rebuild reads the
    // offline queue to know what the driver has already done, and racing the
    // enqueue would re-read a server that still thinks this bay is pending.
    if (i + 1 >= legs.length) {
      void persist.catch(() => {}).then(() => startNextTripIfAny())
    }
  }, [bookingId, startNextTripIfAny])

  // Arrival detected by the SDK: opens the proof popup for that stop hands-free.
  // Ignored right after a confirmation — if the driver confirmed while parked
  // inside the geofence, an arrival landing a moment later belongs to the stop
  // they just finished and would pop the dialog for the next one.
  const onSdkArrival = useCallback((i: number) => {
    if (Date.now() - lastConfirmAtRef.current < RECENT_CONFIRM_IGNORE_MS) return
    if (i !== cursorRef.current || processedRef.current.has(i)) return
    setAtStop(true)
    setProofFor({ idx: i, auto: true })
  }, [])

  /** Every drop-off confirmed — close the booking out. */
  const markDeliveryDone = useCallback(() => {
    if (completedRef.current) return
    completedRef.current = true
    completeBooking(bookingId).catch(() => {})
    clearBookingCache(bookingId)
    setComplete(true)
  }, [bookingId])

  // The button: opens the same proof popup an arrival would have opened, or —
  // once every stop is confirmed — asks to close the booking out.
  const onConfirmPress = useCallback(() => {
    const legs = legsRef.current
    const i    = cursorRef.current

    if (legs.length > 0 && i >= legs.length) {
      Alert.alert(
        'Mark delivery as done?',
        'This closes the booking. Only do this once every drop-off has been completed.',
        [
          { text: 'Not yet', style: 'cancel' },
          { text: 'Mark as done', style: 'default', onPress: markDeliveryDone },
        ],
      )
      return
    }

    if (!legs[i]) return
    setProofFor({ idx: i, auto: false })
  }, [markDeliveryDone])

  useEffect(() => {
    let cancelled = false

    ;(async () => {
      try {
        // The SDK needs foreground location to render/guide.
        const { status } = await Location.requestForegroundPermissionsAsync()
        if (status !== 'granted') {
          if (!cancelled) setError('Location permission is required for navigation. Enable it in Settings, then tap Retry.')
          return
        }

        // Permission granted ≠ GPS on. Detect it and prompt rather than spinning.
        let servicesOn = await Location.hasServicesEnabledAsync()
        if (!servicesOn) {
          if (ANDROID) {
            try {
              await Location.enableNetworkProviderAsync()
              servicesOn = await Location.hasServicesEnabledAsync()
            } catch { /* driver dismissed the dialog */ }
          }
          if (!servicesOn) {
            if (!cancelled) setError('Location (GPS) is turned off. Turn it on, then tap Retry.')
            return
          }
        }

        const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High })
        if (cancelled) return
        const driver = { latitude: pos.coords.latitude, longitude: pos.coords.longitude }

        // Load the booking (fall back to cache so a flaky start still works).
        let booking: any
        try {
          const { data } = await api.get(`/booking/${bookingId}`)
          booking = data.data
          saveBookingCache(bookingId, booking)
        } catch (netErr) {
          const cached = await loadBookingCache<any>(bookingId)
          if (!cached) throw netErr
          booking = cached
        }
        if (cancelled) return

        // Cargo, grouped by the drop-off it is bound for, so the confirmation
        // popup can show the driver what comes off at the stop in front of them.
        cargoRef.current = groupCargoByDestination(booking.booking_cargo_items)

        // The run the driver is on decides the route. A booking whose cargo
        // exceeds the body is the SAME truck shuttling, so the SDK is given ONE
        // run at a time — origin, then that run's own bays. Handing it every bay
        // at once would route the driver from the last bay of run 1 straight to
        // the first bay of run 2, skipping the reload that is the whole point.
        const { trips } = await fetchTripsWithCache(bookingId)
        if (cancelled) return
        tripsRef.current       = trips
        bookingDataRef.current = booking
        driverStartRef.current = driver

        const plan = buildNavPlan(booking, trips)
        const legs = plan.legs as Leg[]
        const coords: { latitude: number; longitude: number }[] = [
          driver,
          ...legs.map((l) => ({ latitude: l.latitude as number, longitude: l.longitude as number })),
        ]

        if (legs.length === 0) {
          if (!cancelled) setError('No stops with coordinates to navigate. Run route optimization first.')
          return
        }

        legsRef.current      = legs
        cursorRef.current    = 0
        processedRef.current = new Set()
        if (!cancelled) {
          setCursor(0)
          setLegCount(legs.length)
          setDropoffCount(legs.filter((l) => l.type === 'dropoff').length)
        }

        // Every coordinate is a waypoint/destination. Index 0 (the driver's
        // start) must be included for the route to render; the rest are the
        // ordered stops the SDK will report arrivals for.
        if (!cancelled) {
          setWaypointIndices(coords.map((_, i) => i))
          setCoordinates(coords)
        }
      } catch (e: any) {
        if (!cancelled) setError(e?.response?.data?.message ?? e?.message ?? 'Failed to start navigation.')
      }
    })()

    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookingId, retry])

  if (error) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 14, backgroundColor: C.bg }}>
        <Text style={{ color: C.red, fontSize: 14, textAlign: 'center', lineHeight: 21 }}>{error}</Text>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <TouchableOpacity
            onPress={() => { setError(null); setCoordinates(null); setRetry((r) => r + 1) }}
            style={{ paddingVertical: 11, paddingHorizontal: 26, borderRadius: 14, backgroundColor: C.cyan }}
          >
            <Text style={{ color: '#000', fontSize: 14, fontWeight: '800' }}>Retry</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => Linking.openSettings()}
            style={{ paddingVertical: 11, paddingHorizontal: 26, borderRadius: 14, backgroundColor: C.surfaceHi, borderWidth: 1, borderColor: C.border }}
          >
            <Text style={{ color: C.cyan, fontSize: 14, fontWeight: '700' }}>Open settings</Text>
          </TouchableOpacity>
        </View>
      </View>
    )
  }

  if (!coordinates) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: C.bg, gap: 12 }}>
        <ActivityIndicator size="large" color={C.cyan} />
        <Text style={{ color: C.dimWhite, fontSize: 14 }}>Starting navigation…</Text>
      </View>
    )
  }

  const allConfirmed = legCount > 0 && cursor >= legCount
  const currentLeg   = legsRef.current[cursor]
  const confirmLabel = allConfirmed
    ? 'Mark delivery as done'
    : currentLeg?.type === 'pickup'
      ? 'Pickup done'
      : dropoffCount > 1
        ? `Drop-off ${cursor - (legCount - dropoffCount) + 1} of ${dropoffCount} done`
        : 'Drop-off done'

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <MapboxNavigationView
        style={{ flex: 1 }}
        coordinates={coordinates}
        waypointIndices={waypointIndices}
        routeProfile={routeProfileFor(coordinates.length)}
        initialLocation={{ ...coordinates[0], zoom: 15 }}
        // Fires for each intermediate destination in order, so the leg at the
        // current cursor is the one we've reached. The final destination comes
        // through its own callback instead — but it does NOT close the booking:
        // that stays the driver's tap on "Mark delivery as done".
        onWaypointArrival={() => onSdkArrival(cursorRef.current)}
        onFinalDestinationArrival={() => onSdkArrival(legsRef.current.length - 1)}
        onRouteFailedToLoad={(e) => {
          setError(e.nativeEvent?.errorMessage ?? 'Could not build the route. Check your connection and try again.')
        }}
        onCancelNavigation={() => router.back()}
      />

      {/* Emergency, without leaving navigation. A driver having an accident is
          on this screen, not on the reports list — putting a screen transition
          between them and the alert is the one thing this must not do. */}
      <SosButton bookingId={bookingId} />

      {/* Stop confirmation, docked on the right of the map: "Pickup done", then
          "Drop-off N of M done" for each drop-off (1–3 of them), then green
          "Mark delivery as done" once they're all confirmed. */}
      {legCount > 0 && !complete && (
        <TouchableOpacity
          onPress={onConfirmPress}
          activeOpacity={0.85}
          style={{
            position:        'absolute',
            right:           12,
            top:             insets.top + 12,
            zIndex:          25,
            maxWidth:        '76%',
            minHeight:       48,
            paddingVertical: 12,
            paddingHorizontal: 16,
            borderRadius:    24,
            flexDirection:   'row',
            alignItems:      'center',
            gap:             9,
            backgroundColor: allConfirmed ? C.green : atStop ? C.cyan : C.bannerBg,
            borderWidth:     1.5,
            borderColor:     allConfirmed ? C.green : atStop ? C.cyan : C.bannerBorder,
            shadowColor:     '#000',
            shadowOffset:    { width: 0, height: 4 },
            shadowOpacity:   0.5,
            shadowRadius:    12,
            elevation:       12,
          }}
        >
          {allConfirmed
            ? <CheckCircle2 size={20} color="#000" />
            : <PackageCheck size={20} color={atStop ? '#000' : C.cyan} />}
          <Text
            numberOfLines={1}
            style={{ fontSize: 14, fontWeight: '800', color: allConfirmed || atStop ? '#000' : C.white }}
          >
            {confirmLabel}
          </Text>
        </TouchableOpacity>
      )}

      {/* The stop confirmation popup + proof photo. Opened by arrival detection
          or by the button above; both go through confirmLeg on confirm. */}
      {proofFor !== null && legsRef.current[proofFor.idx] && (
        <StopProofModal
          visible
          kind={legsRef.current[proofFor.idx].type === 'pickup' ? 'pickup' : 'dropoff'}
          title={
            legsRef.current[proofFor.idx].type === 'pickup'
              ? 'Pickup'
              : dropoffCount > 1
                ? `Drop-off ${proofFor.idx - (legCount - dropoffCount) + 1} of ${dropoffCount}`
                : 'Drop-off'
          }
          address={legsRef.current[proofFor.idx].address ?? undefined}
          autoOpened={proofFor.auto}
          stopCoordinates={legCoordinates(legsRef.current[proofFor.idx])}
          manifest={manifestForLeg(legsRef.current[proofFor.idx])}
          onCancel={() => setProofFor(null)}
          onConfirm={(photoUri, proof) => {
            const idx = proofFor.idx
            setProofFor(null)
            confirmLeg(idx, photoUri, proof)
          }}
        />
      )}

      {complete && (
        <View
          style={{
            position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 50,
            alignItems: 'center', justifyContent: 'center',
            backgroundColor: 'rgba(10,10,10,0.92)', paddingHorizontal: 32, gap: 18,
          }}
        >
          <Text style={{ color: C.white, fontSize: 26, fontWeight: '900', textAlign: 'center' }}>Trip Complete</Text>
          <Text style={{ color: C.dimWhite, fontSize: 14, textAlign: 'center' }}>
            All {legsRef.current.filter((l) => l.type === 'dropoff').length} drop-off
            {legsRef.current.filter((l) => l.type === 'dropoff').length !== 1 ? 's' : ''} delivered.
          </Text>
          <TouchableOpacity
            onPress={() => router.back()}
            style={{ marginTop: 6, paddingVertical: 14, paddingHorizontal: 48, borderRadius: 16, backgroundColor: C.cyan }}
          >
            <Text style={{ color: '#000', fontSize: 15, fontWeight: '800' }}>Done</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  )
}

/**
 * Renders setup guidance instead of crashing when the native Mapbox Navigation
 * module isn't in the build yet (e.g. running before a dev build / in Expo Go).
 */
class NavErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { failed: boolean }
> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch(err: unknown) { console.warn('[MapboxNavSDK] render failed:', err) }

  render() {
    if (this.state.failed) {
      return (
        <View style={{ flex: 1, justifyContent: 'center', padding: 24, backgroundColor: C.bg }}>
          <Text style={{ color: C.white, fontSize: 15, textAlign: 'center', lineHeight: 22 }}>
            Could not load the Mapbox Navigation SDK. Rebuild the app with
            @badatgil/expo-mapbox-navigation configured (npx expo prebuild --clean
            then npx expo run:android) — it isn’t available in Expo Go.
          </Text>
        </View>
      )
    }
    return this.props.children
  }
}
