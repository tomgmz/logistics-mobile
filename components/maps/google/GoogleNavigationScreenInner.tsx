import React, { useCallback, useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Alert, Linking, PixelRatio, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Signpost, CheckCircle2, PackageCheck, WifiOff } from 'lucide-react-native'
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
import {
  saveRouteGeometry,
  loadRouteGeometry,
  clearRouteGeometry,
  type CachedRouteGeometry,
  type GeoPoint,
  type RouteStopMarker,
} from '../../../lib/routeGeometryCache'
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
import { groupCargoByDestination, manifestFor } from '../../../lib/cargoManifest'
import { legCoordinates } from '../../../lib/stopGeofence'
import { GoogleNavSheet, SHEET_PEEK_H } from './GoogleNavSheet'
import { OfflineRoutePreview } from './OfflineRoutePreview'
import { C } from '../../../theme/navigation.theme'

/**
 * Real Google Navigation SDK screen. Loaded lazily by GoogleNavigationScreen
 * once the native module is present (i.e. after a prebuild/dev build with the
 * SDK configured).
 *
 * The SDK owns the map itself — routing, the route line, snapping, camera,
 * voice and rerouting. We hide two pieces of the chrome it draws over that map
 * (its instruction header and its ETA card) and put our own on top, per the
 * Figma "Tracking [in transit]" frame: turn card, round map controls and the
 * trip sheet. Its re-center button stays its own, and nothing here touches the
 * camera. Our jobs:
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
  /** The driver chose to run this ahead of its scheduled day. */
  earlyStart?: boolean
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

/**
 * How long to wait for the SDK to build the first route before giving up on it.
 *
 * Measured on a real dead zone, not guessed: `setDestinations` offline does NOT
 * reject — it never settles at all. Without a deadline the screen sits on
 * "Starting navigation…" forever, and it stays there even after the connection
 * comes back, because the reconnect handler is watching for a failure that never
 * arrived. A route on a live connection lands in a few seconds; anything past
 * this is the hang, not a slow build.
 */
const ROUTE_BUILD_TIMEOUT_MS = 20_000

// Flip to `true` to see the stock Google Navigation experience: its own header
// and ETA card come back and EVERY overlay of ours is withheld — turn card,
// round map controls, banners and the trip sheet. That makes it a clean A/B for
// "is the SDK drawing this, or are we covering it?", which is the only way to
// answer that: the SDK's chrome renders inside a closed AAR, so which controls
// it shows and when can't be read from source.
//
// All waypoint/arrival/booking logic runs the same either way, and arrival
// detection still opens the proof popup on its own, so a trip stays completable
// with our controls hidden.
const SHOW_NATIVE_UI = false


/**
 * The round map controls — the Figma "Tracking [in transit]" frame draws them as
 * light discs with a 2px status-coloured ring, stacked down the right edge.
 *
 * They hang under Google's compass, which is the stock Maps SDK control
 * (UiSettings.setCompassEnabled) rather than anything this wrapper positions.
 * That means its box is fixed: a 48dp container at a 12dp right margin, with the
 * visible disc inset inside it by the drawable's own padding.
 *
 * So these match the compass's BOX rather than its visible circle — same width,
 * same margin. Guessing at the circle can't work: with a different box size the
 * centre lines never line up, whatever margin you pick. The frame's own 40px is
 * given up here on purpose; it has no compass to sit under.
 */
const MAP_BTN_FILL = '#f2e4e4'
const MAP_BTN_RED  = '#f62626'
const MAP_BTN_IDLE = '#818181'

/**
 * The gap left ABOVE the trip sheet's CLOSED height when declaring the map's
 * bottom obscured, via mapPadding.
 *
 * Small on purpose. The SDK already insets its own furniture ~22dp inside
 * whatever area we leave it, so the sheet's peek height alone is enough to clear
 * it and this is only the breathing room on top.
 *
 * It used to be 140, back when the padding was handed over in dp and read as px
 * (see sdkBottomClearancePx): roughly a third of it survived the unit mismatch,
 * so a number this large was needed to land anywhere near right. Correcting the
 * units made all 140 of it real and threw the re-center button most of the way
 * up the screen. Anything raised here is also camera framing, not just spacing,
 * because padding is what tells the SDK where centre is.
 */
const SDK_GAP = 8

/**
 * The Maps SDK compass container, matched exactly.
 *
 * The margin is measured, not assumed: on device the compass disc's centre sits
 * ~23dp in from the right edge, not the 12dp its container margin would imply,
 * so a column at 12 stood a noticeable 11dp to its right. Centres are what the
 * eye reads down a vertical stack, so this is set to put ours on the compass's.
 */
const MAP_BTN_SIZE  = 48
const MAP_BTN_RIGHT = 23
/** Below the compass, measured down from the top safe-area inset. */
const MAP_BTN_TOP   = 164
/** Disc height plus the gap between them. */
const MAP_BTN_PITCH = MAP_BTN_SIZE + 6

/**
 * The column under the compass, one evenly spaced slot per button: SOS, the
 * avoid-highways toggle, then confirm-stop.
 *
 * Every button in it is MAP_BTN_SIZE wide at MAP_BTN_RIGHT, the compass's own
 * box — same width and same margin is what puts their centres on one line, so
 * nothing here should be sized or inset on its own. Slots are numbered rather
 * than offset by hand so a button can be added or reordered without the ones
 * below it drifting.
 */
const mapBtnSlotTop = (slot: number) => MAP_BTN_TOP + slot * MAP_BTN_PITCH

const MAP_BTN = {
  position:        'absolute' as const,
  right:           MAP_BTN_RIGHT,
  width:           MAP_BTN_SIZE,
  height:          MAP_BTN_SIZE,
  borderRadius:    MAP_BTN_SIZE / 2,
  alignItems:      'center' as const,
  justifyContent:  'center' as const,
  backgroundColor: MAP_BTN_FILL,
  borderWidth:     2,
  shadowColor:     '#000',
  shadowOffset:    { width: 0, height: 4 },
  shadowOpacity:   0.25,
  shadowRadius:    4,
  elevation:       8,
}

export default function GoogleNavigationScreenInner({ bookingId, routeToken, earlyStart = false }: Props) {
  return (
    <NavigationProvider termsAndConditionsDialogOptions={TOS_OPTIONS}>
      <GoogleNavInner bookingId={bookingId} routeToken={routeToken} earlyStart={earlyStart} />
    </NavigationProvider>
  )
}

function GoogleNavInner({ bookingId, routeToken, earlyStart = false }: Props) {
  const router = useRouter()
  const insets = useSafeAreaInsets()


  /**
   * Measured from the sheet's CLOSED height, never its live one.
   *
   * Pinning it is the point. Tying this to the live height moved the SDK's
   * re-center button every time the driver opened or closed the board, and moved
   * the camera with it — padding is what tells the SDK where centre is, so the
   * map lurched on each drag. Worse, a button that travels has to be chased: the
   * dismiss-on-touch-outside scrim had to be cut back to wherever it had got to,
   * against a button whose height is Google's to change and grows with the
   * device's font and display-size settings.
   *
   * Held at the peek height, the button sits in one place for the whole trip and
   * the camera never shifts underneath the driver. The cost is that an OPEN board
   * covers it — re-centering means closing the board first, which is one tap on
   * something that is already under the driver's thumb.
   */
  const sdkBottomClearance = SHEET_PEEK_H + insets.bottom + SDK_GAP
  /**
   * The same clearance in PIXELS, which is the unit `mapPadding` is documented
   * in — "Sets padding on the map in pixels".
   *
   * Everything else in React Native is dp, so handing it the raw number silently
   * under-pads by the device's pixel ratio: on this 560dpi phone (ratio 3.5) a
   * 200dp strip was declared as 200px ≈ 57dp, and the SDK's re-center button
   * came to rest UNDER the trip sheet — pushed up, but nowhere near enough. It
   * looks correct only at 160dpi, where dp and px happen to be the same number.
   */
  const sdkBottomClearancePx = Math.round(sdkBottomClearance * PixelRatio.get())

  /**
   * Forces mapPadding to be re-sent to the native side.
   *
   * The SDK drops the padding it was given at mount somewhere in the course of
   * starting guidance, and React will not re-send a prop whose value has not
   * changed — so the padding is simply gone, and the SDK's re-center button
   * comes to rest under the trip sheet where no driver can reach it. It springs
   * back the instant anything alters the value, which is why opening the sheet
   * has always "fixed" it, and why the button appeared to drop only sometimes.
   *
   * Alternating one pixel is what makes the value change. It is below the
   * threshold of anything visible and it is the whole point: a NEW number is the
   * only thing that reaches the native view.
   */
  const [padEpoch, setPadEpoch] = useState(0)
  const bumpMapPadding = useCallback(() => setPadEpoch((e) => e + 1), [])
  const {
    navigationController,
    setOnArrival,
    setOnNavigationReady,
    setOnTurnByTurn,
    setOnRouteChanged,
    removeAllListeners,
  } = useNavigation()

  const [error, setError] = useState<string | null>(null)
  const [navInfo, setNavInfo] = useState<{
    instruction:    string
    stepDistanceM:  number
    nextEtaS?:      number
    nextDistanceM?: number
    finalEtaS?:     number
    steps?:         { instruction: string; distanceM: number }[]
  } | null>(null)
  const [rerouting, setRerouting] = useState(false)
  const [avoidHighways, setAvoidHighways] = useState(false)
  const [toggleError, setToggleError] = useState<string | null>(null)
  // The planned stops and which one is current. The trip sheet renders the list.
  const [stops, setStops]       = useState<DisplayStop[]>([])
  const [legIndex, setLegIndex] = useState(0)
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
  // The cached route to draw when guidance can't be built at all (cold open in a
  // dead zone). Non-null means the preview screen is up instead of navigation.
  const [offlinePreview, setOfflinePreview] = useState<CachedRouteGeometry | null>(null)

  const legsRef       = useRef<Leg[]>([])
  // Booking cargo grouped by destination, for the stop manifest.
  const cargoRef = useRef(groupCargoByDestination([]))
  // The booking's runs, and the booking itself, kept so the screen can rebuild
  // the route for the NEXT run when the current one finishes. On a shuttle the
  // driver returns to the origin and reloads; that is a new route, not a
  // continuation of the one the SDK is holding.
  const tripsRef   = useRef<Trip[]>([])
  const bookingRef = useRef<any>(null)
  // Set between runs: the current load is delivered and the truck is heading
  // back for the next one. Drives the "reload" card instead of the completion one.
  const [reloading, setReloading] = useState(false)

  /** The manifest for the drop-off a leg ends at; empty for the pickup leg. */
  const manifestForLeg = (leg: Leg | undefined) =>
    leg && leg.type === 'dropoff' ? manifestFor(cargoRef.current, leg.destinationId) : null

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

  /**
   * Write the route the SDK is currently guiding to disk, so a COLD OPEN in a
   * dead zone has something to draw (OfflineRoutePreview).
   *
   * The in-memory session marker already covers the driver leaving this screen
   * and coming back — the native session is still alive and gets re-attached.
   * What it cannot survive is the process dying: a crash, a reboot, Android
   * reclaiming the app while it sat in the yard. That driver comes back to an
   * SDK with no route and no way to build one without signal.
   *
   * Called after every point where the route changes — first start, reroute,
   * highways toggle, each stop confirmed, the next run of a shuttle — and
   * deliberately never awaited by its callers: this is a backup, and a slow
   * AsyncStorage write must not hold up guidance.
   */
  const captureRouteGeometry = useCallback(async () => {
    try {
      const segments = await navigationController.getRouteSegments()

      // Segments run from the driver's position to each remaining waypoint, so
      // flattening them gives the line from HERE to the end of the run — which
      // is what a restore should draw, not the part already driven.
      const points: GeoPoint[] = (segments ?? []).flatMap((segment: any) =>
        (segment?.segmentLatLngList ?? []).map((p: any) => ({
          latitude:  p?.lat,
          longitude: p?.lng,
        })),
      )

      // Markers come from the legs rather than the segments: a leg carries the
      // stop's own coordinates, while a segment ends wherever the route could
      // reach the road, which can be a block away from the bay.
      const markers: RouteStopMarker[] = []
      legsRef.current.forEach((leg, i) => {
        const at = legCoordinates(leg)
        const stop = stopsRef.current[i]
        if (!at || !stop) return
        markers.push({
          ...at,
          stopIndex: i,
          kind:      stop.kind,
          number:    stop.number,
          label:     stop.label,
        })
      })

      await saveRouteGeometry({
        bookingId,
        points,
        markers,
        legIndex: legIndexRef.current,
        stops:    stopsRef.current,
      })
    } catch {
      // No segments to read (guidance not running yet, or the SDK refused).
      // Whatever was cached before stays put — a slightly older route still
      // beats the blank error screen this exists to replace.
    }
  }, [bookingId, navigationController])

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
      captureRouteGeometry()
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
        .then(() => captureRouteGeometry())
        .catch(() => { /* still flaky; keep coasting on the cached route */ })
        .finally(() => {
          applyingRef.current = false
          setTimeout(() => setRerouting(false), 1500)
        })
    } else if (offlineStartErrorRef.current) {
      // Guidance never started because we were offline — retry automatically
      // now that the connection is back. This is also what takes the offline
      // route preview down: the retry rebuilds the real route behind it.
      offlineStartErrorRef.current = false
      setError(null)
      setOfflinePreview(null)
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
   * The run just finished — start the next one, or leave the booking ready to
   * be closed.
   *
   * This is the shuttle's turning point. The truck has emptied the last bay of
   * this run and is heading back to the origin; if operations planned another
   * run there is a whole new route to build, starting at the pickup point
   * again. Rebuilding rather than continuing matters: the SDK is holding a
   * route that ends where the driver is standing, and "continue" would send
   * them to the next bay without the reload in between.
   *
   * Position reporting stops for the empty leg back — a truck returning for
   * another load is not on a delivery anyone is tracking.
   */
  const startNextTripIfAny = useCallback(async () => {
    endTripLeg()

    // The server closed this run when its last bay landed, so the plan has to
    // be re-read to see it. Falls back to the cached copy in a dead zone, which
    // still knows which runs exist — only their statuses may be stale, and the
    // local leg cursor is what actually drives the screen.
    let trips = tripsRef.current
    try {
      const fresh = await fetchTripsWithCache(bookingId)
      trips = fresh.trips
      tripsRef.current = trips
    } catch { /* keep what we have */ }

    const plan = buildNavPlan(bookingRef.current ?? {}, trips)

    // No run left with anywhere to drive: the booking is done bar the tap.
    if (!plan.trip || plan.nothingToNavigate || plan.waypoints.length === 0) {
      setReloading(false)
      nothingToNavigateRef.current = true
      return
    }

    setReloading(true)
    waypointsRef.current = plan.waypoints
    legsRef.current      = plan.legs
    legIndexRef.current  = 0
    processedRef.current = new Set()
    stopsRef.current     = plan.stops
    setStops(plan.stops)
    setLegIndex(0)
    // A route token encodes one fixed route; the next run is a different one.
    useTokenRef.current = false
    updateNavSession({
      waypoints: plan.waypoints,
      legs:      plan.legs,
      stops:     plan.stops,
      legIndex:  0,
      processed: [],
    })

    try {
      await applyDestinations()
      guidingRef.current = true
      captureRouteGeometry()
    } catch {
      // Offline, most likely: the SDK cannot build a route without network. The
      // reconnect handler already re-applies destinations, and the driver can
      // retry from the button.
    }
  }, [bookingId, applyDestinations, captureRouteGeometry])

  /**
   * The driver said the stop is done and photographed it: record stop `idx` with
   * its proof and move guidance to the next one. The single write path — the
   * proof popup is the only thing that calls it, whether the popup was opened by
   * arrival detection or by the confirm button.
   *
   * After the last drop-off guidance stops and the button turns into "Mark
   * delivery as done" (completeDelivery).
   */
  const advanceStop = useCallback(async (idx: number, photoUri: string, proof: StopProofContext) => {
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
    // Where the driver is headed next, so live tracking can tighten its update
    // cadence as the truck closes on that stop. Null on the last leg.
    const nextStop = legCoordinates(legsRef.current[idx + 1])
    const persist = leg.type === 'pickup'
      ? confirmTripPickup(bookingId, leg.tripId, photoUri, earlyStart, proof, nextStop)
      : confirmTripStop(leg.tripStopId, photoUri, proof, nextStop)
    persist.catch(() => {})

    legIndexRef.current = idx + 1
    setLegIndex(idx + 1)
    setArrivedIdx(null)
    // Persist progress so a remount (driver leaving and re-opening the screen)
    // resumes on the right leg instead of starting over.
    updateNavSession({ legIndex: idx + 1, processed: [...processedRef.current] })

    try {
      if (idx + 1 >= legs.length) {
        // Last stop of THIS RUN confirmed. On a shuttle that is not the end of
        // the job — the truck drives back to the origin, loads again, and runs
        // a new route. Stop guidance either way, then see whether another run
        // is waiting.
        guidingRef.current = false
        await navigationController.stopGuidance().catch(() => {})
        // Wait for the confirmation to be QUEUED before rebuilding. The rebuild
        // reads the queue to know what the driver has already done; racing it
        // would re-read a server that still thinks this bay is pending and route
        // the driver straight back to it.
        await persist.catch(() => {})
        await startNextTripIfAny()
      } else {
        // Move to the next waypoint. startGuidance is a no-op when guidance is
        // already running; it covers the case where the SDK paused on arrival.
        await navigationController.continueToNextDestination().catch(() => {})
        await navigationController.startGuidance().catch(() => {})
        // Re-snapshot so a restore resumes at the stop ahead, not the one just
        // finished. Offline this is a no-op and the older snapshot stands.
        captureRouteGeometry()
      }
    } finally {
      confirmingRef.current = false
      setConfirming(false)
    }
  }, [bookingId, navigationController, startNextTripIfAny, captureRouteGeometry])

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
    clearRouteGeometry(bookingId)
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
    // Fires once, whichever way the start dies — the watchdog below or an
    // outright rejection — so the driver can't be dropped to the preview twice.
    let startResolved = false
    let watchdog: ReturnType<typeof setTimeout> | undefined
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
          // Feeds the sheet's ETA strip and its "ON THE WAY" total.
          nextEtaS:      e.timeToNextDestinationSeconds ?? undefined,
          nextDistanceM: e.distanceToNextDestinationMeters ?? undefined,
          finalEtaS:     e.timeToFinalDestinationSeconds ?? undefined,
          // Every manoeuvre still ahead — what the turn card drops down to show.
          steps: (e.getRemainingSteps ?? []).map((st: any) => ({
            instruction: st?.instruction ?? '',
            distanceM:   st?.distanceMeters ?? 0,
          })),
        })
      })
      setOnRouteChanged(() => {
        if (cancelled) return
        bumpMapPadding()
        setRerouting(true)
        // The SDK swapped the route under us — the cached one is now wrong.
        // Read it back after the reroute settles rather than mid-swap.
        setTimeout(() => { if (!cancelled) captureRouteGeometry() }, 1500)
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
      bumpMapPadding()
      setStarting(false)

      return () => {
        cancelled = true
        removeAllListeners()
        try { navigationController.setTurnByTurnLoggingEnabled(false) } catch {}
        // Keep the native session ALIVE so the next entry can resume again.
      }
    }

    /**
     * Everything that has to happen once a route exists. Shared by the normal
     * path and by a build that came back LATE, after we had already given up and
     * dropped to the offline preview.
     */
    const onRouteBuilt = () => {
      startResolved = true
      if (watchdog) clearTimeout(watchdog)
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
      // The SDK has just rebuilt its furniture; re-assert our padding over it.
      bumpMapPadding()
      setTimeout(() => { if (!cancelled) bumpMapPadding() }, 2000)
      // Snapshot the route now that the SDK has actually built one, so a
      // crash-and-reopen out of coverage still has a line to draw.
      captureRouteGeometry()
      if (cancelled) return
      // Takes the offline preview down if a late build beat us to it.
      setOfflinePreview(null)
      setStarting(false)
    }

    /**
     * No route: fall back to the cached one, or to the error screen when there
     * isn't one. Shared by the two ways a start can fail — an outright rejection,
     * and the silent hang that offline actually produces.
     */
    const onRouteBuildFailed = async (message: string) => {
      if (cancelled || startResolved) return
      startResolved = true
      if (watchdog) clearTimeout(watchdog)
      setStarting(false)

      // Arm the auto-retry unconditionally rather than only when NetInfo admits
      // we're offline: the hang also happens on a connection that is nominally
      // up but going nowhere, and that driver needs the reconnect to rescue them
      // just as much.
      offlineStartErrorRef.current = true

      // A route cached from an earlier start beats dead-ending on an error the
      // driver can do nothing about. It is not navigation and the preview says
      // so, but a driver mid-run with no signal needs to see where they were up
      // to far more than they need a red screen.
      const cachedRoute = await loadRouteGeometry(bookingId)
      if (cancelled) return

      if (cachedRoute) {
        // The booking cache may have carried nothing (first run on this device,
        // or it was evicted), in which case the snapshot's own stop list is all
        // there is. Seed from it so the sheet has a board to draw.
        if (stopsRef.current.length === 0 && cachedRoute.stops.length > 0) {
          stopsRef.current    = cachedRoute.stops
          legIndexRef.current = cachedRoute.legIndex
          setStops(cachedRoute.stops)
          setLegIndex(cachedRoute.legIndex)
        }
        setOfflinePreview(cachedRoute)
        return
      }

      setError(message)
    }

    // Start guidance only once BOTH the navigator is ready and the booking's
    // waypoints have loaded. Calling setDestinations before the navigator is
    // ready throws "initialize the navigator before executing".
    const maybeBegin = async () => {
      if (cancelled || started || !navReady || waypointsRef.current.length === 0) return
      started = true

      const attempt = applyDestinations()
      // Claim the rejection now so the race below can't leave it unhandled.
      const settled = attempt.then(() => 'built' as const, (e: any) => e ?? new Error('failed'))

      const outcome = await Promise.race([
        settled,
        new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), ROUTE_BUILD_TIMEOUT_MS)),
      ])

      if (outcome === 'built') {
        onRouteBuilt()
        return
      }

      if (outcome === 'timeout') {
        // The SDK is still chewing on a route it will probably never produce.
        // Show the driver something usable now, but DON'T abandon the attempt:
        // if it does land, onRouteBuilt takes the preview back down.
        await onRouteBuildFailed(
          'Navigation is taking too long to start — it needs a connection to build the route. It will resume automatically once you reconnect.',
        )
        settled.then((late) => { if (late === 'built') onRouteBuilt() })
        return
      }

      await onRouteBuildFailed(
        offlineRef.current
          ? 'Can’t start a new route while offline — navigation needs a connection to build it. Reconnecting will resume automatically.'
          : (outcome?.message ?? 'Failed to start guidance.'),
      )
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

        // Cargo, grouped by the drop-off it is bound for, so the confirmation
        // popup can show the driver what comes off at the stop in front of them.
        cargoRef.current = groupCargoByDestination(booking.booking_cargo_items)

        // The run the driver is on decides the route. A booking whose cargo
        // exceeds the body is the SAME truck shuttling, so the SDK is given ONE
        // run at a time — origin, then that run's own bays. Handing it every bay
        // at once would route the driver from the last bay of run 1 straight to
        // the first bay of run 2, skipping the reload that is the whole point.
        const { trips } = await fetchTripsWithCache(bookingId)
        tripsRef.current   = trips
        bookingRef.current = booking

        const plan = buildNavPlan(booking, trips)

        // Nothing left to drive to, but the booking is still open: every bay on
        // every run has been confirmed and only "Mark delivery as done" remains
        // (the driver left the screen before finishing, or the app restarted).
        // Show the map with the completion button instead of a dead-end error.
        if (plan.nothingToNavigate) {
          nothingToNavigateRef.current = true
          waypointsRef.current = []
          legsRef.current      = []
          stopsRef.current     = plan.stops
          legIndexRef.current  = plan.stops.length
          setStops(plan.stops)
          setLegIndex(plan.stops.length)
          return
        }

        if (plan.waypoints.length === 0) {
          bookingError = new Error('No stops with coordinates to navigate. Run route optimization first.')
          return
        }

        waypointsRef.current = plan.waypoints
        legsRef.current      = plan.legs
        legIndexRef.current  = 0
        processedRef.current = new Set()
        stopsRef.current     = plan.stops
        setStops(plan.stops)
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

        /**
         * One deadline over the ENTIRE start sequence.
         *
         * An earlier version put the timeout around the routing call alone, and
         * a real dead zone walked straight past it: offline the SDK never gets
         * as far as routing — `init()` doesn't return and onNavigationReady
         * never fires — so a deadline scoped to routing is never even armed, and
         * the screen sits on "Starting navigation…" forever.
         *
         * Armed here, after the Terms dialog and the permission prompts, so the
         * clock measures the SDK and not how long the driver took to read
         * something.
         */
        const armWatchdog = () => {
          if (watchdog) clearTimeout(watchdog)
          watchdog = setTimeout(() => {
            if (cancelled || guidingRef.current) return
            void onRouteBuildFailed(
              'Navigation is taking too long to start — it needs a connection to build the route. It will resume automatically once you reconnect.',
            )
          }, ROUTE_BUILD_TIMEOUT_MS)
        }

        // Show Terms immediately — independent of the booking fetch.
        armWatchdog()
        const accepted = await navigationController.areTermsAccepted()
        if (!accepted) {
          await navigationController.showTermsAndConditionsDialog()
          // The driver just spent an unbounded amount of time reading; none of
          // it should count against the SDK.
          armWatchdog()
        }
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
      if (watchdog) clearTimeout(watchdog)
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

  /**
   * Where the stop being confirmed actually is.
   *
   * Normally straight off the leg. On the offline preview the legs may never
   * have been built (no booking cached on this device), and the snapshot's
   * markers are the only coordinates left — looked up by the stop index they
   * carry, since a stop without coordinates leaves a hole in that list.
   */
  const stopCoordinatesFor = (idx: number) =>
    legCoordinates(legsRef.current[idx]) ??
    offlinePreview?.markers.find((m) => m.stopIndex === idx) ??
    null

  /**
   * The stop confirmation popup + proof photo. Opened by arrival detection or by
   * the confirm button; both go through advanceStop. Declared here rather than
   * inline because the offline preview shows the SAME popup — a stop confirmed
   * in a dead zone is the case the offline queue exists for, and the preview
   * would be a poor substitute if it could only be looked at.
   */
  const proofModal = proofFor !== null && stops[proofFor.idx] ? (
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
      stopCoordinates={stopCoordinatesFor(proofFor.idx)}
      manifest={manifestForLeg(legsRef.current[proofFor.idx])}
      onCancel={() => setProofFor(null)}
      onConfirm={(photoUri, proof) => {
        const idx = proofFor.idx
        setProofFor(null)
        advanceStop(idx, photoUri, proof)
      }}
    />
  ) : null

  // No guidance to show: the SDK couldn't build a route and we're offline, but a
  // route from an earlier start is cached. Draw that — the line, the stops and
  // the board — instead of the error screen. Retry is both manual (the header
  // button) and automatic (handleReconnectRef, on the connection returning).
  if (offlinePreview) {
    return (
      <View style={{ flex: 1 }}>
        <OfflineRoutePreview
          geometry={offlinePreview}
          stops={stops}
          legIndex={legIndex}
          retrying={starting}
          onRetry={() => {
            offlineStartErrorRef.current = false
            setOfflinePreview(null)
            setError(null)
            setStarting(true)
            setRetry((r) => r + 1)
          }}
          onBack={() => router.back()}
          onConfirmStop={(idx) => {
            // A stop can only be recorded against the leg that names its trip
            // stop. Without the legs there is nothing to confirm AGAINST, and a
            // photo taken here would have nowhere to go — so say that plainly
            // rather than opening a popup that silently loses the driver's work.
            if (!legsRef.current[idx]) {
              Alert.alert(
                'Can’t confirm while offline',
                'This booking’s details were never saved on this phone, so the stop can’t be recorded yet. It will work as soon as you have a signal.',
              )
              return
            }
            setProofFor({ idx, auto: false })
          }}
        />
        {proofModal}
      </View>
    )
  }

  // Google owns the map and its own nav chrome. We withhold its instruction
  // header and ETA card, draw our turn card and trip sheet in their place, and
  // declare the sheet's strip as map padding so the SDK moves its remaining
  // controls clear of it.
  return (
    <View style={{ flex: 1, backgroundColor: '#0a0a0a' }}>
      <NavigationView
        style={StyleSheet.absoluteFill}
        headerEnabled={SHOW_NATIVE_UI}
        // Our sheet takes the footer's place, so that one is off. The camera —
        // including the SDK's own re-center button and everything it does with
        // following mode — is left entirely alone.
        footerEnabled={SHOW_NATIVE_UI}
        // Declares the bottom strip as obscured so the SDK draws its OWN
        // furniture — the re-center button, and the traffic/flood callouts —
        // above our sheet instead of behind it. Our sheet is a sibling rendered
        // after this view, so it always wins on z-order; moving what the SDK
        // draws is the only way, and this prop is the only lever for it.
        //
        // A layout declaration, not a camera call: no controller, no moveCamera,
        // no perspective. Bottom only, so the compass and the disc column keep
        // their positions.
        mapPadding={SHOW_NATIVE_UI ? undefined : { bottom: sdkBottomClearancePx + (padEpoch % 2) }}
        // Dark map: during a nav session the theme is driven by
        // navigationNightMode (not a cloud mapId/color scheme), so force night.
        navigationNightMode={NavigationNightMode.FORCE_NIGHT}
      />
      {!SHOW_NATIVE_UI && (
        <GoogleTurnCard
          instruction={navInfo?.instruction}
          stepDistanceM={navInfo?.stepDistanceM}
          steps={navInfo?.steps}
          isRerouting={rerouting}
          onBack={() => router.back()}
          // The leg being driven: from the stop just cleared to the one ahead.
          // Before the pickup there is no previous stop, so the driver's own
          // position is the start.
          fromLabel={legIndex > 0 ? stops[legIndex - 1]?.label : 'Current location'}
          fromAddress={legIndex > 0 ? stops[legIndex - 1]?.address : 'On the way'}
          toLabel={currentStop?.label}
          toAddress={currentStop?.address}
        />
      )}

      {/* Emergency, without leaving navigation. A driver having an accident is
          on this screen, not on the reports list — putting a screen transition
          between them and the alert is the one thing this must not do.

          It heads the right-hand disc column, directly above the avoid-highways
          toggle: the topmost slot the compass leaves free, and the one a thumb
          finds without looking. */}
      <SosButton
        bookingId={bookingId}
        top={insets.top + mapBtnSlotTop(0)}
        right={MAP_BTN_RIGHT}
        size={MAP_BTN_SIZE}
      />

      {/* Offline banner. The SDK keeps guiding on the route it already loaded
          (~15–20 min cache) but can't reroute or render unseen areas while
          offline — so set that expectation rather than letting it silently
          stall. */}
      {!SHOW_NATIVE_UI && offline && (
        <View
          style={{
            // Under the turn card, stopping short of the compass / button column.
            position:        'absolute',
            left:            22,
            right:           MAP_BTN_RIGHT + MAP_BTN_SIZE + 12,
            top:             insets.top + 104,
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
      {!SHOW_NATIVE_UI && (
      <TouchableOpacity
        onPress={toggleAvoidHighways}
        activeOpacity={0.85}
        accessibilityRole="switch"
        accessibilityState={{ checked: avoidHighways }}
        accessibilityLabel="Avoid highways"
        style={[MAP_BTN, { top: insets.top + mapBtnSlotTop(1), zIndex: 21, borderColor: avoidHighways ? MAP_BTN_RED : MAP_BTN_IDLE }]}
      >
        <Signpost size={22} color={avoidHighways ? MAP_BTN_RED : MAP_BTN_IDLE} strokeWidth={1.5} />
      </TouchableOpacity>
      )}

      {/* Transient banner shown when an avoid-highways recompute fails. The
          toggle has already reverted to the route actually being guided. */}
      {!SHOW_NATIVE_UI && toggleError && (
        <View
          style={{
            // Shares the banner column under the turn card; drops a row when the
            // offline banner is already sitting in the first slot.
            position:        'absolute',
            left:            22,
            right:           MAP_BTN_RIGHT + MAP_BTN_SIZE + 12,
            top:             insets.top + (offline ? 148 : 104),
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

      {/* Stop confirmation — the driver's control over trip progress, drawn as
          the green disc in the right-hand stack. Which stop it applies to is
          read from the trip sheet below; the disc itself carries no label, so
          confirmLabel now only names it for screen readers.

          For a stop, this opens the proof popup — the same one arrival detection
          opens by itself — so this button is how the driver gets there when the
          geofence never fired, or after dismissing it. */}
      {!SHOW_NATIVE_UI && stops.length > 0 && !completed && (
        <TouchableOpacity
          onPress={onConfirmPress}
          disabled={confirming}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel={confirmLabel}
          style={[
            MAP_BTN,
            {
              top:         insets.top + mapBtnSlotTop(2),
              zIndex:      25,
              opacity:     confirming ? 0.6 : 1,
              borderColor: C.green,
            },
          ]}
        >
          {confirming
            ? <ActivityIndicator size="small" color={C.green} />
            : isFinalAction
              ? <CheckCircle2 size={22} color={C.green} strokeWidth={1.5} />
              : <PackageCheck size={22} color={C.green} strokeWidth={1.5} />}
        </TouchableOpacity>
      )}

      {/* Trip panel over the bottom of the map — ETA strip collapsed, the whole
          route board when expanded. Replaces Google's footer. */}
      {!SHOW_NATIVE_UI && !completed && stops.length > 0 && (
        <GoogleNavSheet
          stops={stops}
          legIndex={legIndex}
          etaSeconds={navInfo?.nextEtaS}
          distanceM={navInfo?.nextDistanceM}
          totalEtaSeconds={navInfo?.finalEtaS}
          onConfirmStop={(idx) => setProofFor({ idx, auto: false })}
        />
      )}

      {proofModal}

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
