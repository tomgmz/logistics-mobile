import AsyncStorage from '@react-native-async-storage/async-storage'
import NetInfo from '@react-native-community/netinfo'
import { AppState, AppStateStatus } from 'react-native'

import api from './api/auth.api'

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
 * `delivery:<stopId>`). Re-enqueuing the same id is a no-op, which dedupes the
 * proximity + manual-button double-fire and survives screen remounts. Backend
 * status transitions are forward-only (pending → delivered, assigned →
 * in_transit), so re-applying is harmless — the id only avoids redundant calls.
 */

export interface QueuedAction {
  id:        string                    // 'pickup:<bookingId>' | 'delivery:<stopId>'
  kind:      'pickup' | 'delivery'
  url:       string                    // '/booking/:id/status' | '/booking-destinations/:id/status'
  body:      Record<string, unknown>   // { status: 'in_transit' | 'delivered' }
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

    for (const item of queue) {
      if (stop) { remaining.push(item); continue }
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
        } else if (status === 403) {
          // The driver app calls admin-gated routes; a 403 is an authorization
          // mismatch (drivers not allowed on these routes), NOT an applied
          // update. Keep it and surface loudly instead of silently dropping.
          console.warn(
            `[offlineQueue] 403 on ${item.url} — status update rejected. ` +
            `The driver role likely lacks access to this route; add 'driver' ` +
            `to its authorize() list on the backend.`,
            item,
          )
          remaining.push({ ...item, attempts: item.attempts + 1 })
        } else {
          // Other 4xx (e.g. 409/422 already-applied) → idempotent success, drop.
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
