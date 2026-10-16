import AsyncStorage from '@react-native-async-storage/async-storage'
import type { Waypoint } from '@googlemaps/react-native-navigation-sdk'

/**
 * Marker for the navigation session that is CURRENTLY running on the native
 * side.
 *
 * The Google Navigation SDK keeps its native guidance session alive on its own
 * (taskRemovedBehavior CONTINUE_SERVICE, set explicitly on the provider) — it
 * only dies when we call `cleanup()` or Android kills the process. So when the
 * driver leaves the maps screen and comes back, the native session is still
 * guiding; we just need to know it's there so we can RE-ATTACH the view instead
 * of rebuilding the route from scratch (which needs the network and fails in a
 * dead zone).
 *
 * This holds the bits of progress that live only in React (leg cursor, the
 * planned stops, the avoid-highways preference) so a remount can restore them
 * without re-fetching the booking.
 *
 * Kept in memory AND on disk. Memory answers the common case (driver backed out
 * of the map). Disk covers the driver swiping the app away: Google's guidance
 * keeps running in its foreground service, but the app's own memory may not
 * come back with it. The disk copy is only a claim, never proof — the screen
 * asks the SDK whether a route is actually loaded before trusting it, because
 * after a real process death the copy outlives the guidance it describes.
 */

const STORAGE_KEY = 'nav_session_v1'

// Each leg carries the coordinates of the stop it ends at, so the proof popup
// can measure the driver against it without re-deriving them from the waypoint
// list by index — the two are built together and must not drift apart.
//
// A leg also names the TRIP it belongs to. One vehicle may run a booking several
// times over (see lib/trips), and a confirmation has to say which run it is
// evidence of: two loads bound for the same bay are two different legs with the
// same destination, and only the trip stop id tells them apart.
export type Leg =
  | { type: 'pickup';  tripId: string; latitude?: number | null; longitude?: number | null }
  | {
      type:          'dropoff'
      tripId:        string
      tripStopId:    string
      destinationId: string
      latitude?:     number | null
      longitude?:    number | null
    }

// Display model for the numbered stop-list overlay (pickup + drop-offs in order).
export interface DisplayStop {
  kind:    'pickup' | 'dropoff'
  number?: number
  label:   string
  address: string
  /** Set only on a booking that really is a shuttle — e.g. "TRIP 2 OF 3". */
  tripLabel?: string | null
}

export interface NavSession {
  bookingId:     string
  waypoints:     Waypoint[]
  legs:          Leg[]
  stops:         DisplayStop[]
  legIndex:      number
  processed:     number[]
  avoidHighways: boolean
  /**
   * The driver chose to run this ahead of its scheduled day. Carried here so a
   * resumed session still declares it on the pickup confirmation — the server
   * refuses an early first pickup that doesn't.
   */
  earlyStart:    boolean
}

let active: NavSession | null = null

// Never awaited by callers: a slow or failed write must not hold up guidance.
// The worst case is a resume that rebuilds the route instead of re-attaching.
function persist(session: NavSession | null): void {
  const write = session
    ? AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(session))
    : AsyncStorage.removeItem(STORAGE_KEY)
  write.catch(() => {})
}

/**
 * The session for this booking that may still be guiding: the in-memory one,
 * else the one saved to disk before the app was swiped away. Null when neither
 * is for this booking.
 */
export async function loadResumableNavSession(bookingId: string): Promise<NavSession | null> {
  if (active?.bookingId === bookingId) return active
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const saved = JSON.parse(raw) as NavSession
    return saved?.bookingId === bookingId ? saved : null
  } catch {
    return null
  }
}

/** The live native session, or null when nothing is guiding. */
export function getActiveNavSession(): NavSession | null {
  return active
}

/** Whether a session for this booking is already guiding (i.e. resumable). */
export function isNavSessionActive(bookingId: string): boolean {
  return active?.bookingId === bookingId
}

/** Record a freshly started session (overwrites any previous marker). */
export function startNavSession(session: NavSession): void {
  active = session
  persist(active)
}

/** Patch the running session's progress (leg cursor, processed legs, etc.). */
export function updateNavSession(patch: Partial<NavSession>): void {
  if (!active) return
  active = { ...active, ...patch }
  persist(active)
}

/** Clear the marker once the session has been (or is about to be) cleaned up. */
export function endNavSession(): void {
  active = null
  persist(null)
}
