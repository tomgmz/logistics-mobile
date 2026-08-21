import NetInfo from '@react-native-community/netinfo'

import { enqueue, flush } from './offlineQueue'
import { uploadProofPhoto } from './proofPhoto'

/**
 * Driver-confirmed trip progress.
 *
 * The driver works through the stops from the navigation map: pickup done →
 * guidance continues to the drop-offs → each drop-off done → the whole delivery
 * marked done. Every pickup and drop-off carries a proof photo taken at the
 * stop; the backend refuses the confirmation without one.
 *
 * Every confirmation goes through the durable offline queue, so a stop confirmed
 * in a dead zone is synced on reconnect. The queue drains FIFO, which matches the
 * order the backend enforces (pickup → drop-offs → completion).
 */

/**
 * Queue a stop confirmation together with its proof photo.
 *
 * When we're online the photo is uploaded first so the queued entry is a plain
 * status update; when we're not, the local file URI is queued with it and the
 * queue uploads on reconnect. Either way this resolves as soon as the work is
 * durably recorded — the driver never waits on the network to move to the next
 * stop.
 */
async function queueStop(
  id: string,
  kind: 'pickup' | 'delivery',
  url: string,
  photoUri: string,
  extraBody?: Record<string, unknown>,
): Promise<void> {
  let uploadedUrl: string | null = null

  const net = await NetInfo.fetch().catch(() => null)
  if (net?.isConnected) {
    // Best effort: a failure here just means the queue uploads it later.
    uploadedUrl = await uploadProofPhoto(photoUri).catch(() => null)
  }

  await enqueue({
    id,
    kind,
    url,
    body:     { ...extraBody, ...(uploadedUrl ? { proof_photo_url: uploadedUrl } : {}) },
    photoUri: uploadedUrl ? undefined : photoUri,
  })
  await flush()
}

/**
 * Pickup loaded, with proof photo — moves the booking to `in_transit`.
 *
 * `earlyStart` carries the driver's decision to run this booking ahead of its
 * scheduled day. The server refuses an early pickup without it, and records the
 * override when it's set — so it has to ride along in the queued body rather
 * than being decided at drain time, which may be hours later.
 */
export function confirmPickup(bookingId: string, photoUri: string, earlyStart = false): Promise<void> {
  return queueStop(
    `pickup:${bookingId}`,
    'pickup',
    `/driver/bookings/${bookingId}/pickup`,
    photoUri,
    earlyStart ? { early_start: true } : undefined,
  )
}

/** One drop-off unloaded, with proof photo — marks that destination `delivered`. */
export function confirmDelivery(bookingId: string, destinationId: string, photoUri: string): Promise<void> {
  return queueStop(
    `delivery:${destinationId}`,
    'delivery',
    `/driver/bookings/${bookingId}/destinations/${destinationId}/delivered`,
    photoUri,
  )
}

/** Every drop-off done — marks the booking `completed`. Needs no photo of its own. */
export function completeBooking(bookingId: string): Promise<void> {
  return enqueue({
    id:   `complete:${bookingId}`,
    kind: 'complete',
    url:  `/driver/bookings/${bookingId}/complete`,
    body: {},
  }).then(() => flush())
}
