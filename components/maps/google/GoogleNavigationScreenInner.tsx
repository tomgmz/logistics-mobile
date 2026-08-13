import React, { useCallback, useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Alert, Linking, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Milestone, Truck, Check, CheckCircle2, PackageCheck, ListOrdered, WifiOff } from 'lucide-react-native'
import NetInfo from '@react-native-community/netinfo'
import * as Location from 'expo-location'
import {
  NavigationProvider,
  NavigationView,
  NavigationNightMode,
  useNavigation,
  TravelMode,
  type ArrivalEvent,
  type Waypoint,
} from '@googlemaps/react-native-navigation-sdk'

import api from '../../../lib/api/auth.api'
import { flush } from '../../../lib/offlineQueue'
import { confirmPickup, confirmDelivery, completeBooking } from '../../../lib/tripProgress'
import { saveBookingCache, loadBookingCache, clearBookingCache } from '../../../lib/navCache'
import {
  type Leg,
  type DisplayStop,
  getActiveNavSession,
  isNavSessionActive,
  startNavSession,
  updateNavSession,
  endNavSession,
} from '../../../lib/navSession'
import { GoogleTurnCard } from './GoogleTurnCard'
import { StopProofModal } from '../shared/StopProofModal'
import { C } from '../../../theme/navigation.theme'

/**
 * Real Google Navigation SDK screen. Loaded lazily by GoogleNavigationScreen
 * once the native module is present (i.e. after a prebuild/dev build with the
 * SDK configured).
 *
 * The SDK owns routing, snapping, voice and rerouting, and renders most of its
 * own navigation UI (footer, speedometer, recenter, etc.). We hide only its
 * instruction header and replace it with our Mapbox-style turn card. Our jobs:
 *   1. Feed it waypoints from the backend (GET /booking/:id).
 *   2. Turn each confirmed stop into a booking status update, with the proof
 *      photo the driver took there.
 *   3. Render a custom turn card from its turn-by-turn callbacks.
 *
 * Arrival detection still drives the flow: reaching a stop opens the proof popup
 * by itself, hands-free. The confirm button on the right of the map opens the
 * same popup for when that detection doesn't fire — weak GPS, a geofence that
 * can't be reached, an address a few hundred metres off. What it can no longer
 * do is record a stop silently, because every pickup and drop-off needs a photo
 * and a "yes, this is done" from the driver. Once every drop-off is confirmed
 * the button becomes "Mark delivery as done", which completes the booking.
 *
 * Waypoints carry no custom metadata, so arrivals are mapped to stops by their
 * sequence index (navigation is strictly ordered via continueToNextDestination).
 */

interface Props {
  bookingId:   string
  // Optional Routes API route token. When present the SDK guides that exact
  // route; otherwise it computes its own. Currently always unset (the route
  // picker was removed); kept for possible future use.
  routeToken?: string | null
}

const TOS_OPTIONS = {
  title:       '8338 Logistics Navigation',
  companyName: '8338 Logistics',
}

// How long after a stop is confirmed we disregard the SDK's own arrival
// detection. Confirming while parked inside the stop's geofence can trigger an
// arrival event for that same stop moments later; acting on it would pop the
// proof dialog for the next stop while the driver is still at this one. Far
// shorter than any real drive between stops.
const RECENT_CONFIRM_IGNORE_MS = 5_000

// Flip to `false` to restore the custom Mapbox-style overlay (turn card,
// stop list, avoid-highways toggle). When `true` we show the Google
// Navigation SDK's own native chrome (instruction header, footer, etc.) and
// hide our overlays — useful for comparing against the stock SDK experience.
// All waypoint/arrival/booking logic runs the same either way.
const SHOW_NATIVE_UI = false

export default function GoogleNavigationScreenInner({ bookingId, routeToken }: Props) {
  return (
    <NavigationProvider termsAndConditionsDialogOptions={TOS_OPTIONS}>
      <GoogleNavInner bookingId={bookingId} routeToken={routeToken} />
    </NavigationProvider>
  )
}

function GoogleNavInner({ bookingId, routeToken }: Props) {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const {
    navigationController,
    setOnArrival,
    setOnNavigationReady,
    setOnTurnByTurn,
    setOnRouteChanged,
    removeAllListeners,
  } = useNavigation()

  const [error, setError] = useState<string | null>(null)
  const [navInfo, setNavInfo] = useState<{ instruction: string; stepDistanceM: number } | null>(null)
  const [rerouting, setRerouting] = useState(false)
  const [avoidHighways, setAvoidHighways] = useState(false)
  const [toggleError, setToggleError] = useState<string | null>(null)
  // Numbered stop-list overlay: the planned stops, which one is current, and
  // whether the list is expanded.
  const [stops, setStops]       = useState<DisplayStop[]>([])
  const [legIndex, setLegIndex] = useState(0)
  const [stopsOpen, setStopsOpen] = useState(false)
  // Index of the stop whose arrival geofence we're inside, if any — a visual cue
  // on the confirm button for the case where the SDK saw the arrival but the
  // stop wasn't recorded from it.
  const [arrivedIdx, setArrivedIdx] = useState<number | null>(null)
  // True while a stop confirmation is being applied (button disabled so a double
  // tap can't skip a stop).
  const [confirming, setConfirming] = useState(false)
  // The stop whose proof popup is open, and whether it opened by itself (arrival
  // detected) or from the button. Null when the popup is closed.
  const [proofFor, setProofFor] = useState<{ idx: number; auto: boolean } | null>(null)
  // Set once the driver marks the whole delivery done — shows the closing card.
  const [completed, setCompleted]   = useState(false)
  // Bumped by the error screen's Retry button to re-run init (e.g. after the
  // driver turns GPS on).
  const [retry, setRetry] = useState(0)
  // True from mount until guidance is actually running, so we can show a
  // "Starting navigation…" overlay over the gap (route calc + GPS fix) instead
  // of leaving the driver on a plain dot wondering if it's stuck. When we're
  // resuming a session that's already guiding (driver came back to this screen),
  // there's no gap to cover, so start clear.
  const [starting, setStarting] = useState(() => !isNavSessionActive(bookingId))
  // Connectivity. The Google SDK can't compute a route or reroute offline; we
  // use this to give honest messaging rather than a generic failure.
  const [offline, setOffline] = useState(false)
  const offlineRef = useRef(false)

  const legsRef       = useRef<Leg[]>([])
  const legIndexRef   = useRef(0)
  const processedRef  = useRef<Set<number>>(new Set())
  const waypointsRef  = useRef<Waypoint[]>([])
  // Display stops mirrored into a ref so the session snapshot can capture them
  // without threading the loadBooking-local array through.
  const stopsRef      = useRef<DisplayStop[]>([])
  // Read inside async callbacks so we always send the latest preference.
  const avoidHwyRef   = useRef(false)
  // Only recompute on toggle once guidance is actually running.
  const guidingRef    = useRef(false)
  // Serializes route recomputes so overlapping taps / reroutes can't interleave
  // setDestinations calls and leave guidance out of sync with the button.
  const applyingRef   = useRef(false)
  // Whether to navigate the driver's pre-picked route via its token. Only valid
  // at the initial start (full waypoint set, legIndex 0); cleared the moment the
  // driver toggles avoid-highways, since a token encodes one fixed route and is
  // mutually exclusive with routingOptions.
  const useTokenRef   = useRef(!!routeToken)
  // True when guidance failed to START specifically because we were offline, so
  // we can auto-retry the moment the connection returns.
  const offlineStartErrorRef = useRef(false)
  // Latest "back online" handler, kept in a ref so the one-time NetInfo
  // subscription always invokes the current closure (applyDestinations etc.).
  const handleReconnectRef   = useRef<() => void>(() => {})
  // Guards a stop confirmation against re-entrancy, and the completion against a
  // second tap (both also mirrored into state for the UI).
  const confirmingRef = useRef(false)
  const completedRef  = useRef(false)
  // When a stop was last confirmed — see handleArrival.
  const lastConfirmAtRef = useRef(0)
  // Set when the booking has nothing left to navigate (every drop-off already
  // delivered) but hasn't been marked completed yet — the driver re-opened the
  // map just to finish it off.
  const nothingToNavigateRef = useRef(false)

  // (Re)set the SDK's destinations from the CURRENT leg onward. We slice from
  // legIndexRef so the SDK's internal waypoint cursor (advanced by
  // continueToNextDestination) stays aligned with our full-list
  // legIndexRef/legsRef: remaining[k] === full[legIndexRef + k].
  const applyDestinations = useCallback(async () => {
    const remaining = waypointsRef.current.slice(legIndexRef.current)
    if (remaining.length === 0) return

    // Honour the driver's picked route only on the initial start, where the
    // waypoint set still matches the one the token was generated from.
    // Show a marker on the SDK map for every remaining waypoint.
    const displayOptions = { showDestinationMarkers: true }
    if (useTokenRef.current && routeToken && legIndexRef.current === 0) {
      await navigationController.setDestinations(remaining, {
        routeTokenOptions: { routeToken, travelMode: TravelMode.DRIVING },
        displayOptions,
      })
    } else {
      await navigationController.setDestinations(remaining, {
        routingOptions: { avoidHighways: avoidHwyRef.current },
        displayOptions,
      })
    }
    await navigationController.startGuidance()
  }, [navigationController, routeToken])

  const toggleAvoidHighways = useCallback(async () => {
    // Ignore taps while a previous toggle is still recomputing the route, so
    // rapid double-taps can't fire overlapping setDestinations calls.
    if (applyingRef.current) return

    const next = !avoidHwyRef.current
    avoidHwyRef.current = next
    setAvoidHighways(next)

    // The driver is now choosing highways on/off, which means recomputing the
    // route — so the pre-picked token no longer applies (token and routingOptions
    // are mutually exclusive in the SDK).
    useTokenRef.current = false

    // Before guidance starts the preference is applied automatically once
    // guidance begins (see applyDestinations in maybeBegin).
    if (!guidingRef.current) return

    applyingRef.current = true
    setRerouting(true)
    try {
      await applyDestinations()
      // Persist the new preference so a resume re-applies the same route.
      updateNavSession({ avoidHighways: next })
    } catch (e: any) {
      // The recompute failed — revert the flag AND the button so it reflects
      // the route actually being guided, then tell the driver instead of
      // silently leaving the toggle "on" with the old route.
      avoidHwyRef.current = !next
      setAvoidHighways(!next)
      setToggleError('Could not update the route. Tap to try again.')
      console.warn('[nav] avoid-highways toggle failed:', e)
    } finally {
      applyingRef.current = false
      setTimeout(() => setRerouting(false), 1500)
    }
  }, [applyDestinations])

  // Auto-dismiss the transient toggle-failure banner.
  useEffect(() => {
    if (!toggleError) return
    const t = setTimeout(() => setToggleError(null), 4000)
    return () => clearTimeout(t)
  }, [toggleError])

  // What to do when the connection comes back. Defined in render so it closes
  // over the latest applyDestinations; invoked via the ref from the NetInfo
  // subscription below.
  handleReconnectRef.current = () => {
    // Push any status updates that queued up while we were in the dead zone.
    flush().catch(() => {})

    if (guidingRef.current && !applyingRef.current) {
      // Guidance kept running on the cached route while offline but couldn't
      // reroute. Re-apply destinations now that we have a connection so the SDK
      // refreshes the route and rerouting works again.
      applyingRef.current = true
      setRerouting(true)
      applyDestinations()
        .catch(() => { /* still flaky; keep coasting on the cached route */ })
        .finally(() => {
          applyingRef.current = false
          setTimeout(() => setRerouting(false), 1500)
        })
    } else if (offlineStartErrorRef.current) {
      // Guidance never started because we were offline — retry automatically
      // now that the connection is back.
      offlineStartErrorRef.current = false
      setError(null)
      setStarting(true)
      setRetry((r) => r + 1)
    }
  }

  // Track connectivity for honest offline messaging (and the offline banner),
  // and resume full navigation the moment the connection returns.
  useEffect(() => {
    NetInfo.fetch().then((s) => { offlineRef.current = !s.isConnected; setOffline(!s.isConnected) })
    const unsub = NetInfo.addEventListener((s) => {
      const nowOffline = !s.isConnected
      const cameBackOnline = offlineRef.current && !nowOffline
      offlineRef.current = nowOffline
      setOffline(nowOffline)
      if (cameBackOnline) handleReconnectRef.current()
    })
    return () => unsub()
  }, [])

  /**
   * The driver said the stop is done and photographed it: record stop `idx` with
   * its proof and move guidance to the next one. The single write path — the
   * proof popup is the only thing that calls it, whether the popup was opened by
   * arrival detection or by the confirm button.
   *
   * After the last drop-off guidance stops and the button turns into "Mark
   * delivery as done" (completeDelivery).
   */
  const advanceStop = useCallback(async (idx: number, photoUri: string) => {
    if (confirmingRef.current) return
    const legs = legsRef.current
    const leg  = legs[idx]
    // Nothing to do if this stop is already recorded, or if it's no longer the
    // stop we're on.
    if (!leg || idx !== legIndexRef.current || processedRef.current.has(idx)) return

    confirmingRef.current = true
    setConfirming(true)
    processedRef.current.add(idx)
    lastConfirmAtRef.current = Date.now()

    // Persist the status update durably instead of fire-and-forget: if the stop
    // is confirmed in a dead zone, it (and its photo) are queued and synced on
    // reconnect. Idempotency keys dedupe; the queue flushes immediately when
    // we're online.
    const persist = leg.type === 'pickup'
      ? confirmPickup(bookingId, photoUri)
      : confirmDelivery(bookingId, leg.destinationId, photoUri)
    persist.catch(() => {})

    legIndexRef.current = idx + 1
    setLegIndex(idx + 1)
    setArrivedIdx(null)
    // Persist progress so a remount (driver leaving and re-opening the screen)
    // resumes on the right leg instead of starting over.
    updateNavSession({ legIndex: idx + 1, processed: [...processedRef.current] })

    try {
      if (idx + 1 >= legs.length) {
        // Last stop confirmed — nothing left to guide to. Stop guidance but keep
        // the session marker so leaving and re-opening the screen still lands on
        // the "Mark delivery as done" button.
        guidingRef.current = false
        await navigationController.stopGuidance().catch(() => {})
      } else {
        // Move to the next waypoint. startGuidance is a no-op when guidance is
        // already running; it covers the case where the SDK paused on arrival.
        await navigationController.continueToNextDestination().catch(() => {})
        await navigationController.startGuidance().catch(() => {})
      }
    } finally {
      confirmingRef.current = false
      setConfirming(false)
    }
  }, [bookingId, navigationController])

  // The SDK detected the arrival — the normal case, and still what drives the
  // flow: it opens the proof popup for this stop hands-free, so the driver only
  // has to photograph the load and confirm. Recording it silently isn't an
  // option any more; every stop needs that photo.
  //
  // Ignored right after a confirmation: if the driver confirmed while sitting
  // inside the geofence, an arrival landing a moment later belongs to the stop
  // they just finished, and would pop the dialog for the next one.
  const handleArrival = useCallback((_event: ArrivalEvent) => {
    if (Date.now() - lastConfirmAtRef.current < RECENT_CONFIRM_IGNORE_MS) return
    const idx = legIndexRef.current
    if (idx >= legsRef.current.length || processedRef.current.has(idx)) return
    setArrivedIdx(idx)
    setProofFor({ idx, auto: true })
  }, [])

  /** Every drop-off confirmed — mark the whole booking delivered and wrap up. */
  const completeDelivery = useCallback(async () => {
    if (completedRef.current) return
    completedRef.current = true
    setCompleted(true)

    completeBooking(bookingId).catch(() => {})

    clearBookingCache(bookingId)
    endNavSession()
    guidingRef.current = false
    navigationController.stopGuidance().catch(() => {})
    navigationController.cleanup().catch(() => {})
  }, [bookingId, navigationController])

  // The button: opens the same proof popup the arrival would have opened, or —
  // once every stop is confirmed — asks to close the booking out.
  const onConfirmPress = useCallback(() => {
    const idx  = legIndexRef.current
    const legs = legsRef.current
    const allStopsDone = legs.length > 0 && idx >= legs.length

    if (allStopsDone || nothingToNavigateRef.current) {
      Alert.alert(
        'Mark delivery as done?',
        'This closes the booking. Only do this once every drop-off has been completed.',
        [
          { text: 'Not yet', style: 'cancel' },
          { text: 'Mark as done', style: 'default', onPress: () => { completeDelivery() } },
        ],
      )
      return
    }

    if (!legs[idx]) return
    setProofFor({ idx, auto: false })
  }, [completeDelivery])

  useEffect(() => {
    let cancelled = false
    let navReady  = false
    let started   = false
    nothingToNavigateRef.current = false

    // Wire the React-side callbacks onto the SDK's (always-subscribed) event
    // bus. Shared by the fresh-start and resume paths; onNavigationReady is
    // only needed when we init, so it's registered separately below.
    const registerListeners = () => {
      setOnArrival(handleArrival)
      setOnTurnByTurn((events: any[]) => {
        const e = events?.[0]
        if (!e || cancelled) return
        setNavInfo({
          instruction:   e.currentStep?.instruction ?? '',
          stepDistanceM: e.distanceToCurrentStepMeters ?? 0,
        })
      })
      setOnRouteChanged(() => {
        if (cancelled) return
        setRerouting(true)
        setTimeout(() => { if (!cancelled) setRerouting(false) }, 2500)
      })
    }

    // RESUME: a session for this booking is already guiding natively (the
    // driver left the screen and came back). Re-attach to the running session
    // instead of rebuilding the route — this is what lets nav survive even when
    // the signal dropped, since no network round-trip is needed.
    const existing = getActiveNavSession()
    if (existing && existing.bookingId === bookingId) {
      waypointsRef.current = existing.waypoints
      legsRef.current      = existing.legs
      legIndexRef.current  = existing.legIndex
      processedRef.current = new Set(existing.processed)
      stopsRef.current     = existing.stops
      avoidHwyRef.current  = existing.avoidHighways
      useTokenRef.current  = false
      guidingRef.current   = true
      setStops(existing.stops)
      setLegIndex(existing.legIndex)
      setAvoidHighways(existing.avoidHighways)

      registerListeners()
      // Re-enable turn-by-turn forwarding so the turn card refills.
      try { navigationController.setTurnByTurnLoggingEnabled(true) } catch {}
      setStarting(false)

      return () => {
        cancelled = true
        removeAllListeners()
        try { navigationController.setTurnByTurnLoggingEnabled(false) } catch {}
        // Keep the native session ALIVE so the next entry can resume again.
      }
    }

    // Start guidance only once BOTH the navigator is ready and the booking's
    // waypoints have loaded. Calling setDestinations before the navigator is
    // ready throws "initialize the navigator before executing".
    const maybeBegin = async () => {
      if (cancelled || started || !navReady || waypointsRef.current.length === 0) return
      started = true
      try {
        await applyDestinations()
        guidingRef.current = true
        // Mark this as the live native session so leaving and re-opening the
        // screen resumes it (offline-safe) instead of rebuilding the route.
        startNavSession({
          bookingId,
          waypoints:     waypointsRef.current,
          legs:          legsRef.current,
          stops:         stopsRef.current,
          legIndex:      legIndexRef.current,
          processed:     [...processedRef.current],
          avoidHighways: avoidHwyRef.current,
        })
        offlineStartErrorRef.current = false
        if (!cancelled) setStarting(false)
      } catch (e: any) {
        if (!cancelled) {
          setStarting(false)
          // The SDK needs the network to build a route; if we're offline that's
          // the real reason, not a generic failure. Remember it so we can
          // auto-retry the moment the connection returns.
          offlineStartErrorRef.current = offlineRef.current
          setError(
            offlineRef.current
              ? 'Can’t start a new route while offline — navigation needs a connection to build it. Reconnecting will resume automatically.'
              : (e?.message ?? 'Failed to start guidance.'),
          )
        }
      }
    }

    // Load the booking in PARALLEL so the Terms dialog isn't gated behind this
    // network round-trip. Never rejects — errors are captured for the main flow.
    let bookingError: any = null
    const loadBooking = (async () => {
      try {
        let booking: any
        try {
          const { data } = await api.get(`/booking/${bookingId}`)
          booking = data.data
          // Refresh the cache so a later offline start can still derive stops.
          saveBookingCache(bookingId, booking)
        } catch (netErr) {
          // Network failed — fall back to the last cached booking so waypoint
          // derivation (and markers) still work on a flaky connection.
          const cached = await loadBookingCache<any>(bookingId)
          if (!cached) throw netErr
          booking = cached
        }

        const pickedUp    = ['in_transit', 'completed'].includes(booking.status)
        const allStops    = (booking.booking_destinations ?? [])
          .slice()
          .sort((a: any, b: any) => a.sequence_order - b.sequence_order)
        const dropoffs = allStops
          .filter((d: any) => d.latitude != null && d.longitude != null && d.status === 'pending')

        // Nothing left to drive to, but the booking is still open: every drop-off
        // has been confirmed and only "Mark delivery as done" remains (the driver
        // left the screen before finishing, or the app restarted). Show the map
        // with the completion button instead of a dead-end error.
        if (pickedUp && dropoffs.length === 0 && allStops.length > 0 && booking.status !== 'completed') {
          const done: DisplayStop[] = allStops.map((s: any, i: number) => ({
            kind:    'dropoff',
            number:  i + 1,
            label:   `Drop-off ${i + 1}`,
            address: s.address ?? `Drop-off ${i + 1}`,
          }))
          nothingToNavigateRef.current = true
          waypointsRef.current = []
          legsRef.current      = []
          stopsRef.current     = done
          legIndexRef.current  = done.length
          setStops(done)
          setLegIndex(done.length)
          return
        }

        const waypoints: Waypoint[]   = []
        const legs:      Leg[]        = []
        const display:   DisplayStop[] = []
        if (!pickedUp && booking.origin_latitude != null && booking.origin_longitude != null) {
          waypoints.push({ title: 'Pickup', position: { lat: booking.origin_latitude, lng: booking.origin_longitude } })
          legs.push({ type: 'pickup' })
          display.push({ kind: 'pickup', label: 'Pickup', address: booking.origin ?? 'Pickup' })
        }
        dropoffs.forEach((s: any, i: number) => {
          waypoints.push({ title: s.address ?? 'Stop', position: { lat: s.latitude, lng: s.longitude } })
          legs.push({ type: 'dropoff', destinationId: s.destination_id })
          display.push({ kind: 'dropoff', number: i + 1, label: `Drop-off ${i + 1}`, address: s.address ?? `Drop-off ${i + 1}` })
        })
        if (waypoints.length === 0) {
          bookingError = new Error('No stops with coordinates to navigate. Run route optimization first.')
          return
        }

        waypointsRef.current = waypoints
        legsRef.current      = legs
        legIndexRef.current  = 0
        processedRef.current = new Set()
        stopsRef.current     = display
        setStops(display)
        setLegIndex(0)
      } catch (e: any) {
        bookingError = e
      }
    })()

    ;(async () => {
      try {
        // The Navigation SDK requires location permission to render/guide.
        const { status } = await Location.requestForegroundPermissionsAsync()
        if (status !== 'granted') {
          if (!cancelled) setError('Location permission is required for navigation. Enable it in Settings, then tap Retry.')
          return
        }

        // Permission granted ≠ device location/GPS actually on. The SDK can't get
        // a fix if location services are off, so detect it and prompt the driver.
        let servicesOn = await Location.hasServicesEnabledAsync()
        if (!servicesOn) {
          if (Platform.OS === 'android') {
            // Shows the in-app system "turn on location" dialog (Play services).
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
        if (cancelled) return

        // Register listeners BEFORE init so onNavigationReady isn't missed.
        registerListeners()
        setOnNavigationReady(() => { navReady = true; maybeBegin() })

        // Show Terms immediately — independent of the booking fetch.
        const accepted = await navigationController.areTermsAccepted()
        if (!accepted) await navigationController.showTermsAndConditionsDialog()
        if (cancelled) return

        await navigationController.init()

        // Turn-by-turn events (which feed our turn card) are only emitted once
        // the nav-info forwarding service is started; without this the card has
        // no instruction/distance data.
        try { navigationController.setTurnByTurnLoggingEnabled(true) } catch {}

        // Now wait for the (parallel) booking load, then start guidance.
        await loadBooking
        if (cancelled) return
        if (bookingError) {
          setError(bookingError?.response?.data?.message ?? bookingError?.message ?? 'Failed to load booking.')
          return
        }
        // Every stop is already confirmed — there's nothing to guide to, only the
        // completion button to show.
        if (nothingToNavigateRef.current) {
          setStarting(false)
          return
        }
        await maybeBegin()
      } catch (e: any) {
        if (!cancelled) {
          setError(e?.response?.data?.message ?? e?.message ?? 'Failed to start navigation.')
        }
      }
    })()

    return () => {
      cancelled = true
      removeAllListeners()
      try { navigationController.setTurnByTurnLoggingEnabled(false) } catch {}
      // If a session is still live (driver is just leaving the screen, not
      // finished), KEEP the native guidance running so re-opening the booking
      // resumes it — even with no signal. We only tear the session down when
      // it's actually over (handled in completeDelivery) or when start never
      // succeeded (no session marker → safe to clean up here).
      if (!getActiveNavSession()) {
        guidingRef.current = false
        navigationController.stopGuidance().catch(() => {})
        navigationController.cleanup().catch(() => {})
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookingId, retry])

  if (error) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 14, backgroundColor: '#0a0a0a' }}>
        <Text style={{ color: '#ef4444', fontSize: 14, textAlign: 'center', lineHeight: 21 }}>{error}</Text>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <TouchableOpacity
            onPress={() => { offlineStartErrorRef.current = false; setError(null); setStarting(true); setRetry((r) => r + 1) }}
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

  // Driver-facing confirm button state: which stop is being confirmed, what the
  // button says, and whether the next tap closes the booking.
  const allStopsDone  = stops.length > 0 && legIndex >= stops.length
  const currentStop   = stops[legIndex]
  const dropoffCount  = stops.filter((s) => s.kind === 'dropoff').length
  const isFinalAction = allStopsDone || nothingToNavigateRef.current
  const confirmLabel  = isFinalAction
    ? 'Mark delivery as done'
    : currentStop?.kind === 'pickup'
      ? 'Pickup done'
      : dropoffCount > 1
        ? `Drop-off ${currentStop?.number ?? ''} of ${dropoffCount} done`
        : 'Drop-off done'
  // We've arrived but this stop still isn't confirmed — the driver dismissed the
  // proof popup, or it never opened. Highlight the button that reopens it.
  const atCurrentStop = arrivedIdx !== null && arrivedIdx === legIndex

  // Google owns the map + most of its nav chrome (footer, speedometer,
  // recenter). We hide only its instruction header and draw our own turn card
  // on top.
  return (
    <View style={{ flex: 1, backgroundColor: '#0a0a0a' }}>
      <NavigationView
        style={StyleSheet.absoluteFill}
        headerEnabled={SHOW_NATIVE_UI}
        // Dark map: during a nav session the theme is driven by
        // navigationNightMode (not a cloud mapId/color scheme), so force night.
        navigationNightMode={NavigationNightMode.FORCE_NIGHT}
      />
      {!SHOW_NATIVE_UI && (
        <GoogleTurnCard
          instruction={navInfo?.instruction}
          stepDistanceM={navInfo?.stepDistanceM}
          isRerouting={rerouting}
          onBack={() => router.back()}
        />
      )}

      {/* Offline banner. The SDK keeps guiding on the route it already loaded
          (~15–20 min cache) but can't reroute or render unseen areas while
          offline — so set that expectation rather than letting it silently
          stall. */}
      {!SHOW_NATIVE_UI && offline && (
        <View
          style={{
            position:        'absolute',
            right:           12,
            top:             insets.top + 118,
            zIndex:          24,
            flexDirection:   'row',
            alignItems:      'center',
            gap:             7,
            paddingVertical: 9,
            paddingHorizontal: 12,
            borderRadius:    14,
            backgroundColor: C.offlineBg,
            borderWidth:     1,
            borderColor:     C.offlineBorder,
            maxWidth:        '60%',
          }}
        >
          <WifiOff size={15} color={C.orange} />
          <Text style={{ fontSize: 12, fontWeight: '700', color: C.orange, flexShrink: 1 }}>
            Offline · no rerouting
          </Text>
        </View>
      )}

      {/* Avoid-highways toggle. Recomputes the route off motorways — the
          practical lever when GPS keeps snapping you onto a nearby expressway.
          Icon-only round button, docked below the SDK's compass. */}
      <TouchableOpacity
        onPress={toggleAvoidHighways}
        activeOpacity={0.85}
        style={{
          position:        'absolute',
          right:           12,
          top:             insets.top + 190,
          zIndex:          21,
          width:           48,
          height:          48,
          borderRadius:    24,
          alignItems:      'center',
          justifyContent:  'center',
          backgroundColor: C.bannerBg,
          borderWidth:     1.5,
          borderColor:     avoidHighways ? C.cyan : C.bannerBorder,
          shadowColor:     '#000',
          shadowOffset:    { width: 0, height: 4 },
          shadowOpacity:   0.5,
          shadowRadius:    12,
          elevation:       12,
        }}
      >
        <Milestone size={20} color={avoidHighways ? C.cyan : C.dimWhite} />
      </TouchableOpacity>

      {/* Transient banner shown when an avoid-highways recompute fails. The
          toggle has already reverted to the route actually being guided. */}
      {toggleError && (
        <View
          style={{
            position:        'absolute',
            right:           68,
            top:             insets.top + 194,
            maxWidth:        '62%',
            zIndex:          22,
            flexDirection:   'row',
            alignItems:      'center',
            justifyContent:  'center',
            gap:             6,
            paddingVertical: 9,
            paddingHorizontal: 12,
            borderRadius:    12,
            backgroundColor: C.redDim,
            borderWidth:     1,
            borderColor:     C.red,
          }}
        >
          <Text style={{ fontSize: 12, fontWeight: '600', color: C.red, flexShrink: 1, textAlign: 'center' }}>
            {toggleError}
          </Text>
        </View>
      )}

      {/* Stop-list overlay — collapsed to an icon-only round button (matching
          the avoid-highways control) that docks below it on the right. Tapping
          it expands the numbered list of every stop in optimized order, with the
          current stop highlighted and visited ones checked. */}
      {stops.length > 0 && (
        <>
          <TouchableOpacity
            onPress={() => setStopsOpen((o) => !o)}
            activeOpacity={0.85}
            style={{
              position:        'absolute',
              right:           12,
              top:             insets.top + 250,
              zIndex:          23,
              width:           48,
              height:          48,
              borderRadius:    24,
              alignItems:      'center',
              justifyContent:  'center',
              backgroundColor: C.bannerBg,
              borderWidth:     1.5,
              borderColor:     stopsOpen ? C.cyan : C.bannerBorder,
              shadowColor:     '#000',
              shadowOffset:    { width: 0, height: 4 },
              shadowOpacity:   0.5,
              shadowRadius:    12,
              elevation:       12,
            }}
          >
            <ListOrdered size={20} color={stopsOpen ? C.cyan : C.dimWhite} />
          </TouchableOpacity>

          {stopsOpen && (
            <View
              style={{
                position: 'absolute', right: 12, top: insets.top + 368, zIndex: 23,
                width: 260, maxWidth: '72%',
                backgroundColor: C.overlay, borderRadius: 14, borderWidth: 1, borderColor: C.border,
                paddingHorizontal: 12, paddingVertical: 11, gap: 8,
              }}
            >
              {stops.map((s, i) => {
                const done    = i < legIndex
                const current = i === legIndex
                const accent  = s.kind === 'pickup' ? C.cyan : C.orange
                return (
                  <View key={`${s.kind}-${i}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, opacity: done ? 0.5 : 1 }}>
                    <View
                      style={{
                        width: 22, height: 22, borderRadius: 11,
                        backgroundColor: done ? C.green : current ? accent : 'transparent',
                        borderWidth: 1, borderColor: done ? C.green : accent,
                        alignItems: 'center', justifyContent: 'center',
                      }}
                    >
                      {done
                        ? <Check size={12} color="#000" />
                        : s.kind === 'pickup'
                          ? <Truck size={11} color={current ? '#000' : accent} />
                          : <Text style={{ color: current ? '#000' : accent, fontSize: 11, fontWeight: '900' }}>{s.number}</Text>}
                    </View>
                    <Text
                      style={{ color: current ? C.white : C.dimWhite, fontSize: 12, fontWeight: current ? '700' : '400', flex: 1 }}
                      numberOfLines={1}
                    >
                      <Text style={{ color: C.dimWhite }}>{s.label}: </Text>{s.address}
                    </Text>
                  </View>
                )
              })}
            </View>
          )}
        </>
      )}

      {/* Stop confirmation — the driver's control over trip progress, docked
          below the avoid-highways and stop-list circles. It reads "Pickup done"
          on the pickup leg, "Drop-off N of M done" on each drop-off (1–3 of
          them), and once they're all confirmed it turns green: "Mark delivery as
          done", which closes the booking. Wider than the circles above it
          because the label is what makes it unambiguous at a glance.

          For a stop, this opens the proof popup — the same one arrival detection
          opens by itself — so this button is how the driver gets there when the
          geofence never fired, or after dismissing it. */}
      {stops.length > 0 && !completed && (
        <TouchableOpacity
          onPress={onConfirmPress}
          disabled={confirming}
          activeOpacity={0.85}
          style={{
            position:        'absolute',
            right:           12,
            top:             insets.top + 310,
            zIndex:          25,
            maxWidth:        '76%',
            minHeight:       48,
            paddingVertical: 12,
            paddingHorizontal: 16,
            borderRadius:    24,
            flexDirection:   'row',
            alignItems:      'center',
            gap:             9,
            opacity:         confirming ? 0.6 : 1,
            backgroundColor: isFinalAction ? C.green : atCurrentStop ? C.cyan : C.bannerBg,
            borderWidth:     1.5,
            borderColor:     isFinalAction ? C.green : atCurrentStop ? C.cyan : C.bannerBorder,
            shadowColor:     '#000',
            shadowOffset:    { width: 0, height: 4 },
            shadowOpacity:   0.5,
            shadowRadius:    12,
            elevation:       12,
          }}
        >
          {confirming
            ? <ActivityIndicator size="small" color={isFinalAction || atCurrentStop ? '#000' : C.cyan} />
            : isFinalAction
              ? <CheckCircle2 size={20} color="#000" />
              : <PackageCheck size={20} color={atCurrentStop ? '#000' : C.cyan} />}
          <Text
            numberOfLines={1}
            style={{
              fontSize:   14,
              fontWeight: '800',
              color:      isFinalAction || atCurrentStop ? '#000' : C.white,
            }}
          >
            {confirmLabel}
          </Text>
        </TouchableOpacity>
      )}

      {/* The stop confirmation popup + proof photo. Opened by arrival detection
          or by the button above; both go through advanceStop on confirm. */}
      {proofFor !== null && stops[proofFor.idx] && (
        <StopProofModal
          visible
          kind={stops[proofFor.idx].kind}
          title={
            stops[proofFor.idx].kind === 'pickup'
              ? 'Pickup'
              : dropoffCount > 1
                ? `Drop-off ${stops[proofFor.idx].number} of ${dropoffCount}`
                : 'Drop-off'
          }
          address={stops[proofFor.idx].address}
          autoOpened={proofFor.auto}
          onCancel={() => setProofFor(null)}
          onConfirm={(photoUri) => {
            const idx = proofFor.idx
            setProofFor(null)
            advanceStop(idx, photoUri)
          }}
        />
      )}

      {/* Closing card — shown once the driver marks the delivery done. The
          status update may still be queued (dead zone); it syncs on reconnect,
          so there's nothing left for the driver to do here. */}
      {completed && (
        <View
          style={{
            position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 45,
            alignItems: 'center', justifyContent: 'center',
            backgroundColor: 'rgba(10,10,10,0.92)', paddingHorizontal: 32, gap: 16,
          }}
        >
          <CheckCircle2 size={54} color={C.green} />
          <Text style={{ color: C.white, fontSize: 24, fontWeight: '900', textAlign: 'center' }}>Delivery complete</Text>
          <Text style={{ color: C.dimWhite, fontSize: 14, textAlign: 'center', lineHeight: 21 }}>
            {dropoffCount} drop-off{dropoffCount === 1 ? '' : 's'} delivered.
            {offline ? ' It will sync as soon as you’re back online.' : ''}
          </Text>
          <TouchableOpacity
            onPress={() => router.back()}
            style={{ marginTop: 6, paddingVertical: 14, paddingHorizontal: 48, borderRadius: 16, backgroundColor: C.cyan }}
          >
            <Text style={{ color: '#000', fontSize: 15, fontWeight: '800' }}>Done</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* "Starting navigation…" overlay — covers the gap between Start and the
          SDK entering driving mode (route computation + first GPS fix). Clears
          the moment guidance is running. */}
      {starting && (
        <View
          style={{
            position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 40,
            alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(10,10,10,0.55)',
          }}
        >
          <View
            style={{
              flexDirection: 'row', alignItems: 'center', gap: 10,
              paddingVertical: 12, paddingHorizontal: 18, borderRadius: 14,
              backgroundColor: C.overlay, borderWidth: 1, borderColor: C.border,
            }}
          >
            <ActivityIndicator color={C.cyan} />
            <Text style={{ color: C.white, fontSize: 14, fontWeight: '700' }}>Starting navigation…</Text>
          </View>
        </View>
      )}
    </View>
  )
}
