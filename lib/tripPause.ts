import AsyncStorage from '@react-native-async-storage/async-storage'

/**
 * A pause on the delivery: weather, a breakdown, a closed pickup or drop-off.
 * Only the office (Operations or the Company Administrator) pauses and resumes
 * a delivery; the driver sees it here and waits. The office's note reaches the
 * driver in the "paused by the office" notification.
 *
 * The phone keeps the last pause it saw, so the banner stays up in a dead zone;
 * whenever the booking can be read, the server's copy (bookings.paused_at /
 * pause_reason) is the truth.
 */

export const PAUSE_REASONS = [
  { key: 'weather',           label: 'Bad weather' },
  { key: 'vehicle_breakdown', label: 'Vehicle breakdown' },
  { key: 'pickup_closed',     label: 'Pickup point closed' },
  { key: 'dropoff_closed',    label: 'Drop-off point closed' },
  { key: 'road_closed',       label: 'Road closed' },
  { key: 'other',             label: 'Other' },
] as const

export type PauseReason = typeof PAUSE_REASONS[number]['key']

export function pauseReasonLabel(reason: string | null | undefined): string {
  return PAUSE_REASONS.find((r) => r.key === reason)?.label ?? 'Paused'
}

export interface TripPause {
  reason:   PauseReason
  /** Not sent by the server (staff-only); kept for pauses saved by older builds. */
  note?:    string | null
  pausedAt: string
}

const storageKey = (bookingId: string) => `trip_pause_${bookingId}`

async function readLocal(bookingId: string): Promise<TripPause | null> {
  try {
    const raw = await AsyncStorage.getItem(storageKey(bookingId))
    return raw ? (JSON.parse(raw) as TripPause) : null
  } catch {
    return null
  }
}

async function writeLocal(bookingId: string, pause: TripPause | null): Promise<void> {
  try {
    if (pause) await AsyncStorage.setItem(storageKey(bookingId), JSON.stringify(pause))
    else await AsyncStorage.removeItem(storageKey(bookingId))
  } catch { /* only the offline banner is at stake */ }
}

/**
 * The pause in force, as this phone should show it: the server's booking row
 * when there is one (the phone's copy is brought in line with it), otherwise the
 * last pause this phone saw.
 */
export async function currentPause(
  bookingId: string,
  serverBooking?: { paused_at?: string | null; pause_reason?: string | null } | null,
): Promise<TripPause | null> {
  if (!serverBooking) return readLocal(bookingId)

  if (!serverBooking.paused_at) {
    await writeLocal(bookingId, null)
    return null
  }

  const server: TripPause = {
    reason:   (serverBooking.pause_reason ?? 'other') as PauseReason,
    pausedAt: serverBooking.paused_at,
  }
  await writeLocal(bookingId, server)
  return server
}
