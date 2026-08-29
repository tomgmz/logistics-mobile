import * as Location from 'expo-location'
import * as TaskManager from 'expo-task-manager'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { AppState } from 'react-native'

import api from './api/auth.api'
import { distanceInMetres, type Coordinates } from './stopGeofence'

/**
 * The driver's position, streamed to the client's map while a booking runs.
 *
 * This is the only write path in the app that is deliberately LOSSY, and it sits
 * next to code that is deliberately the opposite. Stop confirmations go through
 * `offlineQueue` and survive for hours because losing one erases a delivery that
 * happened. A position is worth something only while it is current: a ping
 * replayed later would drag the truck backwards across the client's map to
 * somewhere it no longer is, and a stuck ping in a FIFO queue would hold up
 * every confirmation behind it. So pings are fire-and-forget — never queued,
 * dropped on any failure, newest wins. Do not "fix" this by routing them through
 * the queue.
 *
 * WHY A BACKGROUND TASK, not the existing `useGps` watcher: `useGps` runs only
 * on the Mapbox custom-map path. The Google Nav SDK and Mapbox Nav SDK paths
 * hand guidance to native code and expose no JS position stream at all, and the
 * provider is a runtime switch (EXPO_PUBLIC_NAV_PROVIDER). Reporting from a
 * background task is what makes tracking work on all three — and it keeps
 * working when the driver locks the screen, which is most of a long haul.
 */

export const LOCATION_TASK = 'DRIVER_LOCATION_TRACKING'

/* ── How often a fix is actually sent ──────────────────────────────────────
 *
 * The OS is asked for fixes far more often than we upload; the tier is decided
 * here, per fix. Sampling is nearly free — the GPS is already running for
 * turn-by-turn — while uploading costs battery, mobile data and a DB write.
 *
 * 10 s is the moving default because at 60 km/h it is 167 m of travel, close
 * enough for the map to interpolate into continuous motion. At 15 s it is 250 m
 * and the marker visibly jumps; below 10 s the extra cost buys a difference
 * invisible at the zoom a client actually watches.
 */

/** Moving normally. The default. */
const MOVING_MS = 10_000

/** Closing on a stop — the window where the receiving clerk is actually watching. */
const NEAR_STOP_MS = 5_000

/** Parked. A heartbeat, so the map can tell "stopped" from "app died". */
const STOPPED_MS = 60_000

/** Screen locked or the driver is in another app. The OS throttles us anyway. */
const BACKGROUND_MS = 30_000

/** How close to the next stop counts as "arriving". */
const NEAR_STOP_RADIUS_M = 2_000

/** Below this the truck is standing still — about 3 km/h. */
const MOVING_SPEED_MPS = 0.8

/**
 * Don't spend a request to say the truck hasn't moved. Trucks idle a great deal
 * in city traffic, and this gate is where most of the saving comes from.
 */
const MIN_MOVE_M = 25

/** The same gate, looser, while backgrounded. */
const MIN_MOVE_BACKGROUND_M = 100

/**
 * ...but always send something within this long, however still the truck is.
 * Silence has to mean "something is wrong", not "parked", or the client's
 * staleness indicator says nothing.
 */
const MAX_SILENCE_MS = 60_000

/**
 * Trip context, in AsyncStorage rather than module state.
 *
 * The task can be invoked in a fresh JS context after the OS has evicted the app,
 * with no memory of what the UI knew. Anything the tier logic needs has to be
 * readable from disk.
 */
const CONTEXT_KEY = 'driver_tracking_context'

interface TrackingContext {
  bookingId: string
  /** The stop being driven to, for the "arriving" tier. Null between stops. */
  nextStop:  Coordinates | null
  /** The last fix actually uploaded — the distance gate measures against this. */
  lastSent:  { latitude: number; longitude: number; at: number } | null
}

async function readContext(): Promise<TrackingContext | null> {
  try {
    const raw = await AsyncStorage.getItem(CONTEXT_KEY)
    return raw ? (JSON.parse(raw) as TrackingContext) : null
  } catch {
    return null
  }
}

async function writeContext(context: TrackingContext): Promise<void> {
  try {
    await AsyncStorage.setItem(CONTEXT_KEY, JSON.stringify(context))
  } catch { /* non-critical — the next fix re-reads and re-decides */ }
}

/** Which cadence applies to this fix, in milliseconds. */
function intervalFor(
  coords:   { latitude: number; longitude: number; speed: number | null },
  nextStop: Coordinates | null,
): number {
  // Backgrounded first: the OS is already rationing us, so asking for 5 s there
  // buys nothing but battery.
  if (AppState.currentState !== 'active') return BACKGROUND_MS

  const speed = coords.speed ?? 0
  if (speed >= 0 && speed < MOVING_SPEED_MPS) return STOPPED_MS

  if (nextStop) {
    const toStop = distanceInMetres(nextStop, coords)
    if (toStop <= NEAR_STOP_RADIUS_M) return NEAR_STOP_MS
  }

  return MOVING_MS
}

/**
 * Decide whether this fix earns an upload, and send it if so.
 *
 * Split out from the task handler so the tier rules can be reasoned about (and
 * exercised) without the OS in the way.
 */
async function considerFix(location: Location.LocationObject): Promise<void> {
  const context = await readContext()
  if (!context) return

  const now      = Date.now()
  const coords   = location.coords
  const interval = intervalFor(
    { latitude: coords.latitude, longitude: coords.longitude, speed: coords.speed },
    context.nextStop,
  )

  const last = context.lastSent
  if (last) {
    const since = now - last.at
    if (since < interval) return

    const moved   = distanceInMetres(last, coords)
    const minMove = AppState.currentState === 'active' ? MIN_MOVE_M : MIN_MOVE_BACKGROUND_M
    if (moved < minMove && since < MAX_SILENCE_MS) return
  }

  // Recorded on the device, because only the device knows when it looked. The
  // backend refuses fixes that reach it too late to be worth drawing.
  const body = {
    latitude:    coords.latitude,
    longitude:   coords.longitude,
    accuracy_m:  coords.accuracy,
    speed_mps:   coords.speed,
    heading_deg: coords.heading,
    recorded_at: new Date(location.timestamp).toISOString(),
  }

  try {
    const res = await api.post(`/driver/bookings/${context.bookingId}/location`, body)

    // 202 means the server took the ping and deliberately did nothing with it —
    // the booking is no longer `in_transit`. That is the authoritative "stop
    // tracking" signal, and it covers the cases the app cannot see for itself:
    // operations cancelled the trip, or an admin closed it out. Without this the
    // phone would keep sampling GPS for a delivery that ended.
    if (res.status === 202) {
      await stopTracking()
      return
    }
  } catch {
    // Dropped on purpose. Retrying would send a position that is already stale
    // by the time it lands, and the next fix is seconds away.
    return
  }

  // Only advance the gate on a fix that actually went out, so a run of failures
  // can't make the app think it has been reporting.
  await writeContext({
    ...context,
    lastSent: { latitude: coords.latitude, longitude: coords.longitude, at: now },
  })
}

/**
 * Registered at module scope: the OS may invoke the task before any screen has
 * mounted, so importing this file is what makes the task exist. It is imported
 * from the driver layout for that reason and no other.
 */
TaskManager.defineTask(LOCATION_TASK, async ({ data, error }) => {
  if (error) {
    console.warn('[tracking] location task error:', error.message)
    return
  }

  const { locations } = (data ?? {}) as { locations?: Location.LocationObject[] }
  if (!locations?.length) return

  // A batch means the OS held fixes back while we were suspended. Only the newest
  // is worth anything — the older ones describe where the truck already isn't.
  const newest = locations.reduce((a, b) => (b.timestamp > a.timestamp ? b : a))
  await considerFix(newest).catch(() => {})
})

/**
 * Ask for background location, having already been granted foreground.
 *
 * Staged deliberately: Android and iOS both want the foreground grant settled
 * before the background one is asked for, and a driver who refuses background
 * should still be able to navigate.
 */
export async function requestTrackingPermissions(): Promise<boolean> {
  const foreground = await Location.requestForegroundPermissionsAsync()
  if (foreground.status !== 'granted') return false

  const background = await Location.requestBackgroundPermissionsAsync()
  return background.status === 'granted'
}

/**
 * Begin reporting position for a booking that is now in transit.
 *
 * Safe to call again for the same booking — a remount of the navigation screen
 * must not restart the task and reset the gate.
 */
export async function startTracking(
  bookingId: string,
  nextStop: Coordinates | null = null,
): Promise<void> {
  const existing = await readContext()
  const already  = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK).catch(() => false)

  if (already && existing?.bookingId === bookingId) {
    // Same trip, new leg: keep the gate, just update where we're heading.
    if (nextStop) await writeContext({ ...existing, nextStop })
    return
  }

  const granted = await requestTrackingPermissions()
  if (!granted) return

  await writeContext({ bookingId, nextStop, lastSent: null })

  if (already) await stopUpdates()

  await Location.startLocationUpdatesAsync(LOCATION_TASK, {
    accuracy: Location.Accuracy.High,
    // The floor the OS delivers on, not the rate we upload at — `considerFix`
    // decides that. Sampling is already paid for by turn-by-turn.
    timeInterval:     5_000,
    distanceInterval: MIN_MOVE_M,
    // Android stops delivering to a backgrounded app without one of these, and
    // a truck being tracked should be visible to the driver as a notification
    // rather than a surprise.
    foregroundService: {
      notificationTitle: 'Delivery in progress',
      notificationBody:  'Sharing your location with the customer while you deliver.',
      notificationColor: '#0891b2',
    },
    // iOS pauses updates when it decides the user has stopped moving, which is
    // exactly when the client most wants a heartbeat.
    pausesUpdatesAutomatically: false,
    activityType: Location.ActivityType.AutomotiveNavigation,
    showsBackgroundLocationIndicator: true,
  })
}

/** The stop the driver is now driving to, which moves the "arriving" tier along. */
export async function setNextStop(nextStop: Coordinates | null): Promise<void> {
  const context = await readContext()
  if (!context) return
  await writeContext({ ...context, nextStop })
}

async function stopUpdates(): Promise<void> {
  const running = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK).catch(() => false)
  if (running) await Location.stopLocationUpdatesAsync(LOCATION_TASK).catch(() => {})
}

/**
 * Stop reporting — the delivery is done, or the driver signed out.
 *
 * The context is cleared as well as the task stopped, so a fix already in flight
 * finds nothing to report against. Tracking a driver who isn't working is the
 * line this feature must not cross, and the backend refuses pings for a booking
 * that isn't `in_transit` for the same reason.
 */
export async function stopTracking(): Promise<void> {
  await stopUpdates()
  try {
    await AsyncStorage.removeItem(CONTEXT_KEY)
  } catch { /* the task returns early without a context anyway */ }
}
