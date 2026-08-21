import api from './api/auth.api'

/**
 * A clock the driver can't set.
 *
 * Everything that gates work by date — chiefly whether a booking's scheduled day
 * has arrived — has to read a time the device doesn't own. A driver who moves
 * their phone's date forward would otherwise walk straight through the gate.
 *
 * We hold an offset against the server's clock rather than its absolute time, so
 * the reading stays live between syncs and survives going offline: the last
 * known offset keeps applying to the device's own ticking clock.
 *
 * The web app does the same thing in `app/utils/serverTime.ts` — keep the two in
 * step.
 */
let offset = 0
let synced = false

/**
 * Measure the gap between this device and the server, correcting for the round
 * trip. Safe to call repeatedly; a failure leaves the previous offset in place.
 */
export async function syncServerTime(): Promise<void> {
  try {
    const before = Date.now()
    const { data } = await api.get('/health')
    const after = Date.now()

    const serverNow = typeof data?.serverTime === 'number'
      ? data.serverTime
      : Date.parse(data?.timestamp ?? '')

    if (!Number.isFinite(serverNow)) return

    // Assume the response was produced halfway through the round trip.
    offset = serverNow - (before + (after - before) / 2)
    synced = true
  } catch {
    // Offline or unreachable — keep whatever offset we already had.
  }
}

/** Milliseconds since the epoch, corrected towards the server's clock. */
export function now(): number {
  return Date.now() + offset
}

/**
 * Whether we've ever reached the server. Callers that would deny the driver
 * something can use this to stay permissive until we actually know the time.
 */
export function hasServerTime(): boolean {
  return synced
}

const PH_OFFSET_MS = 8 * 60 * 60 * 1000

/**
 * Today in Philippine time, as `YYYY-MM-DD` — the same shape `schedule_date`
 * comes back in, so the two compare directly as strings.
 *
 * Fixed UTC+8: the Philippines has no DST, so this needs no timezone database.
 */
export function phToday(at: number = now()): string {
  return new Date(at + PH_OFFSET_MS).toISOString().slice(0, 10)
}
