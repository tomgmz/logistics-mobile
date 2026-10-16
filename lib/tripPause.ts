import AsyncStorage from '@react-native-async-storage/async-storage'

import { enqueue, flush, queuedIds } from './offlineQueue'
import { readCurrentFix } from './stopGeofence'

/**
 * The driver pauses a delivery — weather, a breakdown, a closed pickup or
 * drop-off — and says why. The web shows it on the booking until they resume;
 * the client is told the reason, never the note.
 *
 * Both actions go through the offline queue, like a stop confirmation: a driver
 * sitting out a typhoon is exactly the driver with no signal, and a pause that
 * only exists on their phone tells the office nothing. The queue is FIFO, so a
 * pause, its resume and the stops around them reach the server in the order they
 * happened.
 *
 * Because the server may not hear about it for hours, the phone keeps its own
 * record of the pause in force. That record is what the screens show while
 * anything about this booking's pause is still queued; once the queue is clear,
 * the server's copy (bookings.paused_at / pause_reason) is the truth again.
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
  /** The driver's own note. Present only on this phone's copy; the server never sends it back. */
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
  } catch { /* the queue still carries it; only the banner is at stake */ }
}

/** Anything about this booking's pause still waiting for signal. */
async function pauseChangeQueued(bookingId: string): Promise<boolean> {
  const ids = await queuedIds()
  return ids.some((id) => id.startsWith(`pause:${bookingId}:`) || id.startsWith(`resume:${bookingId}:`))
}

/**
 * Pause the delivery. Resolves as soon as it is durably queued — the driver never
 * waits on the network. Where they are is read now, because by the time a queued
 * pause reaches the server the truck may have been towed.
 */
export async function pauseTrip(bookingId: string, reason: PauseReason, note: string): Promise<TripPause> {
  const pausedAt = new Date().toISOString()
  const pause: TripPause = { reason, note: note.trim(), pausedAt }
  await writeLocal(bookingId, pause)

  const fix = await readCurrentFix().catch(() => null)
  await enqueue({
    id:   `pause:${bookingId}:${Date.parse(pausedAt)}`,
    kind: 'pause',
    url:  `/driver/bookings/${bookingId}/pause`,
    body: {
      reason,
      note:      pause.note,
      paused_at: pausedAt,
      ...(fix ? { latitude: fix.latitude, longitude: fix.longitude, accuracy_m: fix.accuracy_m } : {}),
    },
  })
  void flush()
  return pause
}

/** The driver pressed Resume. */
export async function resumeTrip(bookingId: string): Promise<void> {
  const resumedAt = new Date().toISOString()
  await writeLocal(bookingId, null)
  await enqueue({
    id:   `resume:${bookingId}:${Date.parse(resumedAt)}`,
    kind: 'resume',
    url:  `/driver/bookings/${bookingId}/resume`,
    body: { resumed_at: resumedAt },
  })
  void flush()
}

/**
 * A pickup or drop-off was just confirmed. The server ends a pause on its own
 * when that arrives (the truck is plainly moving), so the phone forgets it too.
 */
export function forgetPause(bookingId: string): Promise<void> {
  return writeLocal(bookingId, null)
}

/**
 * The pause in force, as this phone should show it.
 *
 * While a pause or resume is still queued, the phone's own record wins — the
 * server hasn't heard yet. Otherwise the server's booking row is the truth, and
 * the phone's copy is brought in line with it (an office resume from the web,
 * or a pause that ended when a stop was confirmed).
 */
export async function currentPause(
  bookingId: string,
  serverBooking?: { paused_at?: string | null; pause_reason?: string | null } | null,
): Promise<TripPause | null> {
  const local = await readLocal(bookingId)
  if (!serverBooking || await pauseChangeQueued(bookingId)) return local

  if (!serverBooking.paused_at) {
    if (local) await writeLocal(bookingId, null)
    return null
  }

  const server: TripPause = {
    reason:   (serverBooking.pause_reason ?? 'other') as PauseReason,
    // The server never sends the note back; keep the one this phone typed.
    note:     local?.note ?? null,
    pausedAt: serverBooking.paused_at,
  }
  await writeLocal(bookingId, server)
  return server
}
