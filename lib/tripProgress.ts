import NetInfo from '@react-native-community/netinfo'

import { enqueue, flush } from './offlineQueue'
import { uploadProofPhoto } from './proofPhoto'
import { startTracking, stopTracking, setNextStop } from './locationTracking'
import type { StopFix, Coordinates } from './stopGeofence'

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
 *
 * Each confirmation carries the position captured AT THE STOP, plus the driver's
 * reason when they confirmed one the distance gate would have refused. It has to
 * be captured here and travel with the entry: by the time the queue drains, the
 * driver may be hours and miles away, so a position read at send time would
 * describe the wrong place entirely.
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
export function confirmPickup(
  bookingId: string,
  photoUri: string,
  earlyStart = false,
  proof?: StopProofContext,
  firstDropoff?: Coordinates | null,
): Promise<void> {
  // Pickup is what moves the booking to `in_transit`, which is the only state
  // the backend accepts position pings for — so this is where live tracking
  // begins. Started before the confirmation is queued, deliberately: if the
  // driver is in a dead zone the confirmation may not land for hours, and the
  // customer should still see the truck moving in the meantime.
  //
  // Not awaited, and failures are swallowed: a driver who declined the
  // background-location prompt must still be able to run the delivery.
  void startTracking(bookingId, firstDropoff ?? null).catch(() => {})

  return queueStop(
    `pickup:${bookingId}`,
    'pickup',
    `/driver/bookings/${bookingId}/pickup`,
    photoUri,
    { ...(earlyStart ? { early_start: true } : {}), ...stopProofBody(proof) },
  )
}

/** Where the driver was when they confirmed, and why if they were too far. */
export interface StopProofContext {
  fix:             StopFix | null
  overrideReason?: string | null
}

function stopProofBody(proof?: StopProofContext): Record<string, unknown> {
  if (!proof) return {}
  return {
    ...(proof.fix ? {
      latitude:   proof.fix.latitude,
      longitude:  proof.fix.longitude,
      ...(proof.fix.accuracy_m != null ? { accuracy_m: proof.fix.accuracy_m } : {}),
    } : {}),
    ...(proof.overrideReason ? { override_reason: proof.overrideReason } : {}),
  }
}

/** One drop-off unloaded, with proof photo — marks that destination `delivered`. */
export function confirmDelivery(
  bookingId: string,
  destinationId: string,
  photoUri: string,
  proof?: StopProofContext,
  nextDropoff?: Coordinates | null,
): Promise<void> {
  // Move the "arriving" tier onto the next leg, so the 5 s cadence follows the
  // driver down the route instead of staying pinned to a stop already done.
  void setNextStop(nextDropoff ?? null).catch(() => {})

  return queueStop(
    `delivery:${destinationId}`,
    'delivery',
    `/driver/bookings/${bookingId}/destinations/${destinationId}/delivered`,
    photoUri,
    stopProofBody(proof),
  )
}

/** Every drop-off done — marks the booking `completed`. Needs no photo of its own. */
export function completeBooking(bookingId: string): Promise<void> {
  // The trip is over, so the tracking is too. The backend refuses pings for a
  // booking that isn't `in_transit`, but that is the backstop — a driver's
  // position should stop leaving the phone the moment there is no delivery to
  // justify it, not merely stop being stored.
  void stopTracking().catch(() => {})

  return enqueue({
    id:   `complete:${bookingId}`,
    kind: 'complete',
    url:  `/driver/bookings/${bookingId}/complete`,
    body: {},
  }).then(() => flush())
}
