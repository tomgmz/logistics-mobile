import React, { useEffect, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Linking,
  Platform,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'
import { useRouter } from 'expo-router'
import * as Location from 'expo-location'
import { MapboxNavigationView } from '@badatgil/expo-mapbox-navigation'
import MapboxGL from '@rnmapbox/maps'

import api from '../../../lib/api/auth.api'
import { enqueue, flush } from '../../../lib/offlineQueue'
import { saveBookingCache, loadBookingCache, clearBookingCache } from '../../../lib/navCache'
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
 *   2. Translate its arrival callbacks back into our booking status PATCHes,
 *      mapping each arrival to a leg by order (the SDK exposes no waypoint id).
 *
 * The PATCHes go through the durable offline queue so a confirmation reached in
 * a dead zone is synced on reconnect (same as the Google path).
 */

interface Props {
  bookingId: string
}

type Leg =
  | { type: 'pickup' }
  | { type: 'dropoff'; destinationId: string }

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

MapboxGL.setAccessToken(process.env.EXPO_PUBLIC_MAPBOX_TOKEN ?? '')

export default function MapboxNavSDKScreen({ bookingId }: Props) {
  return (
    <NavErrorBoundary>
      <MapboxNavSDKInner bookingId={bookingId} />
    </NavErrorBoundary>
  )
}

function MapboxNavSDKInner({ bookingId }: Props) {
  const router = useRouter()

  const [coordinates, setCoordinates] = useState<{ latitude: number; longitude: number }[] | null>(null)
  const [waypointIndices, setWaypointIndices] = useState<number[]>([])
  const [error, setError] = useState<string | null>(null)
  const [complete, setComplete] = useState(false)
  const [retry, setRetry] = useState(0)

  const legsRef      = useRef<Leg[]>([])
  const cursorRef    = useRef(0)
  const processedRef = useRef<Set<number>>(new Set())

  // Persist a leg's status update durably. Idempotent: the offline queue dedupes
  // by id, and processedRef guards against the SDK double-firing an arrival.
  const confirmLeg = (i: number) => {
    const legs = legsRef.current
    if (i < 0 || i >= legs.length || processedRef.current.has(i)) return
    processedRef.current.add(i)
    const leg = legs[i]
    if (leg.type === 'pickup') {
      enqueue({
        id:   `pickup:${bookingId}`,
        kind: 'pickup',
        url:  `/booking/${bookingId}/status`,
        body: { status: 'in_transit' },
      }).then(() => flush()).catch(() => {})
    } else {
      enqueue({
        id:   `delivery:${leg.destinationId}`,
        kind: 'delivery',
        url:  `/booking-destinations/${leg.destinationId}/status`,
        body: { status: 'delivered' },
      }).then(() => flush()).catch(() => {})
    }
    if (i === legs.length - 1) clearBookingCache(bookingId)
  }

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

        const pickedUp = ['in_transit', 'completed'].includes(booking.status)
        const dropoffs = (booking.booking_destinations ?? [])
          .filter((d: any) => d.latitude != null && d.longitude != null && d.status === 'pending')
          .sort((a: any, b: any) => a.sequence_order - b.sequence_order)

        const legs:   Leg[] = []
        const coords: { latitude: number; longitude: number }[] = [driver]

        if (!pickedUp && booking.origin_latitude != null && booking.origin_longitude != null) {
          legs.push({ type: 'pickup' })
          coords.push({ latitude: booking.origin_latitude, longitude: booking.origin_longitude })
        }
        dropoffs.forEach((d: any) => {
          legs.push({ type: 'dropoff', destinationId: d.destination_id })
          coords.push({ latitude: d.latitude, longitude: d.longitude })
        })

        if (legs.length === 0) {
          if (!cancelled) setError('No stops with coordinates to navigate. Run route optimization first.')
          return
        }

        legsRef.current      = legs
        cursorRef.current    = 0
        processedRef.current = new Set()

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

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <MapboxNavigationView
        style={{ flex: 1 }}
        coordinates={coordinates}
        waypointIndices={waypointIndices}
        routeProfile={routeProfileFor(coordinates.length)}
        initialLocation={{ ...coordinates[0], zoom: 15 }}
        onWaypointArrival={() => {
          // Fires for each intermediate destination in order. Map to the leg at
          // the current cursor, then advance. The final destination is handled
          // by onFinalDestinationArrival instead.
          const i = cursorRef.current
          cursorRef.current = i + 1
          confirmLeg(i)
        }}
        onFinalDestinationArrival={() => {
          confirmLeg(legsRef.current.length - 1)
          cursorRef.current = legsRef.current.length
          setComplete(true)
        }}
        onRouteFailedToLoad={(e) => {
          setError(e.nativeEvent?.errorMessage ?? 'Could not build the route. Check your connection and try again.')
        }}
        onCancelNavigation={() => router.back()}
      />

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
