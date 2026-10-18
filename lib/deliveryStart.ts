import NetInfo from '@react-native-community/netinfo'

import api from './api/auth.api'
import { isOnline } from './network'
import { enqueue, flush } from './offlineQueue'
import { startTracking, explainTrackingDenied } from './locationTracking'

/**
 * Start (or Resume) Navigation tells the server the delivery has begun.
 *
 * The booking goes `in_transit` there and then — the office sees it live, the
 * client can follow the truck to the pickup, and the crew can no longer be
 * swapped from the web. The server settles it under the booking's row lock, so
 * if the office re-assigned the booking a moment before the tap, this driver is
 * refused here instead of driving off on a job that is no longer theirs.
 *
 *   'started'  — the server agreed (or it was already moving); open the map
 *   'queued'   — no connection; it goes out with the queue, and the pickup
 *                confirmation settles it on the server anyway
 *   { refused } — the server said no: not this driver's booking any more (403),
 *                or it can't start (409: cancelled, vehicle pulled, too early).
 *                The map must NOT open.
 */
export type StartOutcome = 'started' | 'queued' | { refused: string; reassigned: boolean }

export async function startDelivery(bookingId: string, earlyStart: boolean): Promise<StartOutcome> {
  const body = earlyStart ? { early_start: true } : {}
  const net  = await NetInfo.fetch().catch(() => null)

  if (isOnline(net)) {
    try {
      await api.post(`/driver/bookings/${bookingId}/start`, body)
      beginTracking(bookingId)
      return 'started'
    } catch (e: any) {
      const status: number | undefined = e?.response?.status
      if (status === 403 || status === 404 || status === 409) {
        const message: string = e?.response?.data?.message ?? 'This delivery can’t be started right now.'
        return {
          refused:    message,
          // Not "the second driver tried" (also a 403): only losing the booking.
          reassigned: status === 404 || /not assigned to this booking/i.test(message),
        }
      }
      // No answer (dead zone despite the radio, timeout, 5xx): fall through to
      // the queue, exactly as if we had been offline.
    }
  }

  await enqueue({ id: `start:${bookingId}`, kind: 'start', method: 'post', url: `/driver/bookings/${bookingId}/start`, body })
  void flush()
  beginTracking(bookingId)
  return 'queued'
}

/**
 * Live position from the moment the driver sets off — the server records pings
 * once the booking is in transit, which it now is from the start, not the pickup.
 * Never awaited and never fatal: a driver who declined background location can
 * still run the delivery, but is told why the client's map is empty.
 */
function beginTracking(bookingId: string): void {
  void startTracking(bookingId, null)
    .then((result) => { if (result === 'denied') explainTrackingDenied(bookingId) })
    .catch(() => {})
}
