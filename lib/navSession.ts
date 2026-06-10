import type { Waypoint } from '@googlemaps/react-native-navigation-sdk'

/**
 * In-memory marker for the navigation session that is CURRENTLY running on the
 * native side.
 *
 * The Google Navigation SDK keeps its native guidance session alive on its own
 * (taskRemovedBehavior defaults to CONTINUE_SERVICE) — it only dies when we call
 * `cleanup()`. So when the driver leaves the maps screen and comes back, the
 * native session is still guiding; we just need to know it's there so we can
 * RE-ATTACH the view instead of rebuilding the route from scratch (which needs
 * the network and fails in a dead zone).
 *
 * This holds the bits of progress that live only in React (leg cursor, the
 * planned stops, the avoid-highways preference) so a remount can restore them
 * without re-fetching the booking. It is deliberately module-level (not
 * persisted to disk): it mirrors the lifetime of the in-process native session,
 * which a full app restart tears down anyway.
 */

export type Leg =
  | { type: 'pickup' }
  | { type: 'dropoff'; destinationId: string }

// Display model for the numbered stop-list overlay (pickup + drop-offs in order).
export interface DisplayStop {
  kind:    'pickup' | 'dropoff'
  number?: number
  label:   string
  address: string
}

export interface NavSession {
  bookingId:     string
  waypoints:     Waypoint[]
  legs:          Leg[]
  stops:         DisplayStop[]
  legIndex:      number
  processed:     number[]
  avoidHighways: boolean
}

let active: NavSession | null = null

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
}

/** Patch the running session's progress (leg cursor, processed legs, etc.). */
export function updateNavSession(patch: Partial<NavSession>): void {
  if (active) active = { ...active, ...patch }
}

/** Clear the marker once the session has been (or is about to be) cleaned up. */
export function endNavSession(): void {
  active = null
}
