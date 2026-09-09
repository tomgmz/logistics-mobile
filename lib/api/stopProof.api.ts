import api from './auth.api'

/**
 * Supply a proof photo for a drop-off the driver already confirmed.
 *
 * The confirmation happens at the bay — that is the only place it means
 * anything, and it is what the offline queue carries out of a dead zone. The
 * PHOTO sometimes does not make it: an upload that died, a phone out of storage
 * at the tailgate, a queue entry that exhausted its retries.
 *
 * Without this the delivery would stay unevidenced permanently, because
 * re-sending the confirmation is (correctly) a no-op on an already-delivered
 * stop. This is the separate, narrow path for the evidence alone: it never
 * overwrites a photo that is already there, and never touches the position
 * recorded at the stop.
 *
 * Sent directly rather than through the offline queue, deliberately. The queue
 * exists to preserve confirmations the driver made in the field and cannot
 * repeat; this is a deliberate, retryable action the driver takes with the
 * screen in front of them, and a failure they should see rather than one that
 * disappears into a queue.
 */
export async function attachStopProof(tripStopId: string, proofPhotoUrl: string): Promise<void> {
  await api.patch(`/driver/trip-stops/${tripStopId}/proof`, { proof_photo_url: proofPhotoUrl })
}
