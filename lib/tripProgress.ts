import NetInfo from '@react-native-community/netinfo'

import { enqueue, flush } from './offlineQueue'
import { uploadProofPhoto } from './proofPhoto'
import { startTracking, stopTracking, setNextStop } from './locationTracking'
import type { StopFix, Coordinates } from './stopGeofence'

/**
 * Driver-confirmed trip progress.
 *
 * A booking is completed by ONE vehicle making one or more runs: load at the
 * origin, drive to a drop-off, unload, come back, load again. So the shape here
 * is per-run, not per-booking —
 *
 *   confirmTripPickup(trip)  → this run is loaded; the truck is out
 *   confirmTripStop(stop)    → one bay on this run is unloaded
 *   …repeat for every run…
 *   confirmFleetReturn()     → the truck is back in the 8338 lot
 *
 * Every pickup and drop-off carries a proof photo taken at the stop; the backend
 * refuses the confirmation without one. Every run needs its OWN loading photo —
 * a single picture cannot evidence the second time the truck was filled.
 *
 * Every confirmation goes through the durable offline queue, so a stop confirmed
 * in a dead zone is synced on reconnect. The queue drains FIFO, which matches the
 * order the backend enforces (run 1's pickup → run 1's stops → run 2's pickup → …).
 *
 * Each confirmation carries the position captured AT THE STOP, plus the driver's
 * reason when they confirmed one the distance gate would have refused. It has to
 * be captured here and travel with the entry: by the time the queue drains, the
 * driver may be hours and miles away, so a position read at send time would
 * describe the wrong place entirely.
 */

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
 * This run is loaded, with the photo taken at the origin.
 *
 * The FIRST run is what moves the booking to `in_transit`, which is the only
 * state the backend accepts position pings for — so that is where live tracking
 * begins. Later runs restart it, because tracking is stopped when a run's last
 * bay is confirmed and the truck heads back empty; a truck running back to the
 * yard for another load is not a truck the customer needs to watch.
 *
 * `earlyStart` carries the driver's decision to run this booking ahead of its
 * scheduled day. The server refuses an early FIRST pickup without it, and
 * records the override when it's set — so it has to ride along in the queued
 * body rather than being decided at drain time, which may be hours later.
 */
export function confirmTripPickup(
  bookingId: string,
  tripId: string,
  photoUri: string,
  earlyStart = false,
  proof?: StopProofContext,
  firstDropoff?: Coordinates | null,
): Promise<void> {
  // Started before the confirmation is queued, deliberately: if the driver is
  // in a dead zone the confirmation may not land for hours, and the customer
  // should still see the truck moving in the meantime.
  //
  // Not awaited, and failures are swallowed: a driver who declined the
  // background-location prompt must still be able to run the delivery.
  void startTracking(bookingId, firstDropoff ?? null).catch(() => {})

  return queueStop(
    `trip-pickup:${tripId}`,
    'pickup',
    `/driver/trips/${tripId}/pickup`,
    photoUri,
    { ...(earlyStart ? { early_start: true } : {}), ...stopProofBody(proof) },
  )
}

/**
 * One drop-off on one run, unloaded, with proof photo.
 *
 * `nextDropoff` is the next bay ON THIS RUN. Pass null when this was the run's
 * last bay: the truck is heading back to the origin empty, and the "arriving"
 * tracking tier has nothing to arrive at.
 */
export function confirmTripStop(
  tripStopId: string,
  photoUri: string,
  proof?: StopProofContext,
  nextDropoff?: Coordinates | null,
): Promise<void> {
  // Move the "arriving" tier onto the next leg, so the 5 s cadence follows the
  // driver down the route instead of staying pinned to a stop already done.
  void setNextStop(nextDropoff ?? null).catch(() => {})

  return queueStop(
    `trip-stop:${tripStopId}`,
    'delivery',
    `/driver/trip-stops/${tripStopId}/delivered`,
    photoUri,
    stopProofBody(proof),
  )
}

/**
 * The run is over and the truck is heading back for the next load.
 *
 * Nothing is sent — the backend closes a run when its last bay is confirmed.
 * This only stops the position stream, because a truck driving back empty is
 * not something the client is tracking, and the pings would be describing a leg
 * that is not part of anyone's delivery.
 */
export function endTripLeg(): void {
  void stopTracking().catch(() => {})
}

/**
 * Every run done — marks the booking `completed`. Needs no photo of its own.
 *
 * The backend already completes the booking when the final bay of the final run
 * is confirmed; this is the explicit path for the "MARK THIS DELIVERY AS DONE?"
 * confirmation, and the backstop for a booking whose auto-completion failed.
 */
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

/**
 * The vehicle is back in the company parking lot.
 *
 * The last box coming off the truck is not the end of the job — the vehicle
 * still has to come home. Confirmed once, after the booking is completed. No
 * photo: the truck being in the yard is something the fleet can see, and asking
 * for a picture of a parking space at the end of a shift is friction with no
 * evidential value.
 */
export function confirmFleetReturn(
  bookingId: string,
  proof?: StopProofContext,
): Promise<void> {
  void stopTracking().catch(() => {})

  return enqueue({
    id:   `fleet-return:${bookingId}`,
    kind: 'complete',
    url:  `/driver/bookings/${bookingId}/fleet-return`,
    body: stopProofBody(proof),
  }).then(() => flush())
}
