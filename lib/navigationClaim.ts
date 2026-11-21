import api from './api/auth.api'

/**
 * One phone navigates a booking at a time (2026-11-21). The main and the
 * second driver have the same buttons; whoever opens navigation claims it, and
 * if the other driver's phone already holds it this phone asks before taking
 * over. The other phone hears it (live signal) and stops guiding.
 *
 * Offline: the claim cannot reach the server, so navigation opens anyway
 * (the delivery must not stall in a dead zone); the claim is re-sent on the
 * next live-signal catch-up.
 */

export interface NavigatorState {
  driver_id:     string | null
  driver_name:   string | null
  since:         string | null
  last_heard_at: string | null
  fresh:         boolean
  mine:          boolean
}

export type ClaimResult =
  | { kind: 'ok';      state: NavigatorState }
  | { kind: 'held';    state: NavigatorState }
  | { kind: 'refused'; message: string }
  | { kind: 'offline' }

export async function claimNavigation(bookingId: string, takeOver = false): Promise<ClaimResult> {
  try {
    const { data } = await api.post(`/driver/bookings/${bookingId}/navigation`, { take_over: takeOver }, { timeout: 10_000 })
    return { kind: 'ok', state: data.data }
  } catch (e: any) {
    const status = e?.response?.status
    if (status === 409 && e.response.data?.code === 'navigation_held') return { kind: 'held', state: e.response.data.data }
    if (status === 403 || status === 404 || status === 409) {
      return { kind: 'refused', message: e.response.data?.message ?? 'You cannot navigate this delivery.' }
    }
    return { kind: 'offline' }
  }
}

/** Who navigates now, or null when it could not be read (offline). */
export async function readNavigator(bookingId: string): Promise<NavigatorState | null> {
  try {
    const { data } = await api.get(`/driver/bookings/${bookingId}/navigation`, { timeout: 10_000 })
    return data.data as NavigatorState
  } catch {
    return null
  }
}

/** This phone ended navigation. Fire-and-forget: the vehicle's return ends it anyway. */
export function releaseNavigation(bookingId: string): void {
  api.delete(`/driver/bookings/${bookingId}/navigation`, { timeout: 10_000 }).catch(() => {})
}

/** "1 min ago" style text for the take-over prompt. */
export function heardAgo(iso: string | null): string {
  if (!iso) return 'not heard from yet'
  const mins = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60_000))
  return mins < 1 ? 'heard from just now' : `last heard from ${mins} min ago`
}
