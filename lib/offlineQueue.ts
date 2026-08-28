import AsyncStorage from '@react-native-async-storage/async-storage'
import NetInfo from '@react-native-community/netinfo'
import { AppState, AppStateStatus } from 'react-native'

import api from './api/auth.api'
import { uploadProofPhoto } from './proofPhoto'

/**
 * Durable, offline-tolerant queue for booking/destination status updates.
 *
 * The Google Navigation SDK can't run offline, but a driver can still reach a
 * pickup/drop-off in a dead zone. Previously those arrival PATCHes were
 * fire-and-forget (`.catch(() => {})`) and silently lost when offline. This
 * queue persists them to AsyncStorage and flushes on reconnect / app
 * foreground, so a confirmed delivery is never dropped.
 *
 * Idempotency: each action carries a stable `id` (`pickup:<bookingId>` /
 * `delivery:<stopId>` / `complete:<bookingId>`). Re-enqueuing the same id is a
 * no-op, which dedupes double taps and survives screen remounts. The driver
 * progress endpoints are idempotent server-side too (re-confirming a stop
 * returns the current record), so a retry is always harmless.
 *
 * Order matters: the backend rejects a drop-off before the pickup and a
 * completion before the last drop-off, so the queue is drained strictly FIFO
 * and stops at the first entry that couldn't be applied.
 *
 * Each stop also carries the position captured when the driver confirmed it, so
 * the backend's distance check measures where they actually were rather than
 * where they are when the queue happens to drain.
 *
 * Proof photos ride along: a stop confirmed in a dead zone keeps the photo as a
 * local file URI (`photoUri`), which is uploaded here as the first step of
 * applying that entry. The status update is never sent without its proof — the
 * backend would reject it, and a delivery recorded without evidence is exactly
 * what the photo requirement exists to prevent.
 */

// A 409 means the server refused the transition *for now* (e.g. the pickup it
// depends on hasn't landed yet). Retry a bounded number of times rather than
// dropping it like other 4xx — losing a confirmed delivery is worse than a few
// wasted calls.
const MAX_CONFLICT_ATTEMPTS = 5

export interface QueuedAction {
  id:        string                    // 'pickup:<bookingId>' | 'delivery:<stopId>' | 'complete:<bookingId>'
  kind:      'pickup' | 'delivery' | 'complete'
  url:       string                    // '/driver/bookings/:id/pickup' | '.../destinations/:id/delivered' | '.../complete'
  body:      Record<string, unknown>   // { proof_photo_url } for stops; empty for completion
  // Local file URI of a proof photo that still needs uploading. Once uploaded,
  // its hosted URL is merged into `body` as proof_photo_url and this is cleared.
  photoUri?: string
  createdAt: number
  attempts:  number
}

const QUEUE_KEY = 'nav_action_queue'

// Serialize every read-modify-write of the queue (enqueue + flush) so a flush
// can't overwrite an action enqueued while it was running.
let chain: Promise<unknown> = Promise.resolve()
function runExclusive<T>(fn: () => Promise<T>): Promise<T> {
  const next = chain.then(fn, fn) as Promise<T>
  chain = next.catch(() => {})
  return next
}

async function readQueue(): Promise<QueuedAction[]> {
  try {
    const raw = await AsyncStorage.getItem(QUEUE_KEY)
    return raw ? (JSON.parse(raw) as QueuedAction[]) : []
  } catch {
    return []
  }
}

async function writeQueue(queue: QueuedAction[]): Promise<void> {
  try {
    if (queue.length === 0) await AsyncStorage.removeItem(QUEUE_KEY)
    else await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(queue))
  } catch { /* non-critical — retried next flush */ }
}

/**
 * Persist an action. No-op if one with the same id is already queued.
 */
export function enqueue(action: Omit<QueuedAction, 'createdAt' | 'attempts'>): Promise<void> {
  return runExclusive(async () => {
    const queue = await readQueue()
    if (queue.some((a) => a.id === action.id)) return
    queue.push({ ...action, createdAt: Date.now(), attempts: 0 })
    await writeQueue(queue)
  })
}

/**
 * Drain the queue FIFO. Skipped entirely when offline — this is also the auth
 * safeguard: the axios interceptor refreshes the token before each request and
 * logs the session out on refresh failure, so we must never fire a request
 * while there's no connectivity to refresh against.
 */
export function flush(): Promise<void> {
  return runExclusive(async () => {
    const net = await NetInfo.fetch()
    if (!net.isConnected) return

    const queue = await readQueue()
    if (queue.length === 0) return

    const remaining: QueuedAction[] = []
    let stop = false

    for (const queued of queue) {
      if (stop) { remaining.push(queued); continue }

      // Carries a photo that hasn't been uploaded yet (the stop was confirmed in
      // a dead zone). Upload it first and fold the hosted URL into the body —
      // the status update must never be sent without its proof.
      let item = queued
      if (item.photoUri) {
        try {
          const url = await uploadProofPhoto(item.photoUri)
          item = { ...item, body: { ...item.body, proof_photo_url: url }, photoUri: undefined }
          // Persist the URL right away: if the PATCH below fails we retry the
          // request, not the (already successful) upload.
          await writeQueue(queue.map((a) => (a.id === item.id ? item : a)))
        } catch (uploadErr: any) {
          // The photo is what's blocking, not the status update. Keep this entry
          // and everything after it in order, and retry on the next flush.
          console.warn(`[offlineQueue] proof upload failed for ${item.id}; will retry.`, uploadErr?.message)
          stop = true
          remaining.push({ ...item, attempts: item.attempts + 1 })
          continue
        }
      }

      try {
        await api.patch(item.url, item.body)
        // success → drop
      } catch (e: any) {
        const status: number | undefined = e?.response?.status
        if (status === undefined || status === 401 || status >= 500) {
          // Network/timeout, token-refresh failure (interceptor already tried),
          // or a transient server error → keep this and everything after it and
          // stop; retry on the next flush.
          stop = true
          remaining.push({ ...item, attempts: item.attempts + 1 })
        } else if (status === 409 && item.attempts + 1 < MAX_CONFLICT_ATTEMPTS) {
          // Out-of-order transition — the entry this one depends on hasn't been
          // applied yet. Keep it (and everything after it, to preserve order)
          // and try again on the next flush.
          stop = true
          remaining.push({ ...item, attempts: item.attempts + 1 })
        } else if (status === 403) {
          // The signed-in driver isn't the one assigned to this booking (or the
          // route lost its 'driver' authorization). Never an applied update —
          // keep it and surface loudly instead of silently dropping.
          console.warn(
            `[offlineQueue] 403 on ${item.url} — status update rejected. ` +
            `This driver is not assigned to the booking, or the route no longer ` +
            `authorizes the driver role on the backend.`,
            item,
          )
          remaining.push({ ...item, attempts: item.attempts + 1 })
        } else if (status === 422 && e?.response?.data?.code === 'STOP_TOO_FAR') {
          // The server says the driver was too far from the stop. The app checks
          // the same distance before queuing anything, so reaching here means the
          // two disagreed — and dropping it would erase a delivery the driver
          // believes they confirmed. Keep it and say so loudly; it needs a human,
          // not another retry.
          console.warn(
            `[offlineQueue] 422 STOP_TOO_FAR on ${item.url} — the server placed the ` +
            `driver ${e?.response?.data?.distance_m ?? '?'} m from the stop, but this ` +
            `confirmation passed the on-device check. Kept for review; it will not apply ` +
            `until the position or the stop's coordinates are corrected.`,
            item,
          )
          remaining.push({ ...item, attempts: item.attempts + 1 })
        } else {
          // Other 4xx (404, or a 409 that outlived its retries) → nothing more we
          // can do with it; drop rather than retry forever.
          console.warn(`[offlineQueue] dropping ${item.id} on ${status} (treated as already applied).`)
        }
      }
    }

    await writeQueue(remaining)
  })
}

let netUnsub:   (() => void) | null = null
let appSub:     { remove: () => void } | null = null
let wasConnected = true

/**
 * Install a single connectivity listener that flushes on the offline→online
 * edge. Call once from a long-lived layout. Returns an unsubscribe.
 */
export function startAutoFlush(): () => void {
  if (netUnsub) return netUnsub
  netUnsub = NetInfo.addEventListener((state) => {
    const connected = !!state.isConnected
    if (connected && !wasConnected) flush().catch(() => {})
    wasConnected = connected
  })
  // Attempt an initial drain in case actions were left from a previous session.
  flush().catch(() => {})
  return () => { netUnsub?.(); netUnsub = null }
}

/**
 * Flush whenever the app returns to the foreground (it may have reconnected
 * while backgrounded). Call once from a long-lived layout. Returns an
 * unsubscribe.
 */
export function flushOnAppForeground(): () => void {
  if (appSub) return () => { appSub?.remove(); appSub = null }
  const onChange = (s: AppStateStatus) => { if (s === 'active') flush().catch(() => {}) }
  appSub = AppState.addEventListener('change', onChange)
  return () => { appSub?.remove(); appSub = null }
}
