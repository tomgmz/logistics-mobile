import AsyncStorage from '@react-native-async-storage/async-storage'
import api from './api/auth.api'

/**
 * The order the DRIVER chose to work a run's drop-offs in.
 *
 * Operations numbers the drop-offs, but the driver is the one on the road: a
 * bay that is closed until ten, a client who rang to say "come to us first", a
 * jam on the way to stop 1 — the driver can pick which drop-off to do next and
 * guidance reroutes to it. The ops numbering stays on the stop ("Drop-off 3"
 * is still drop-off 3 when it is done first), so the driver and the office are
 * talking about the same bay.
 *
 * Kept on the phone, per run, as the list of trip stop ids in the chosen order.
 * It only has to outlive the app being killed mid-run — without it a restart
 * would quietly send the driver back to ops' order, to a bay they had decided
 * to leave for later. The server does not ENFORCE an order (any outstanding
 * drop-off on a loaded run can be confirmed), but it is told the choice
 * (syncStopOrder) so the office and the client see where the truck is heading
 * and arrival times follow it.
 */

const key = (tripId: string) => `stop_order_${tripId}`

export async function saveStopOrder(tripId: string, tripStopIds: string[]): Promise<void> {
  try {
    await AsyncStorage.setItem(key(tripId), JSON.stringify(tripStopIds))
  } catch { /* non-fatal: the order falls back to ops' numbering */ }
}

/**
 * Tell the server the run's new order. Best effort and never blocking: the
 * phone's copy already drives navigation, and the next change (or the next
 * screen load) sends it again.
 */
export async function syncStopOrder(tripId: string, tripStopIds: string[]): Promise<void> {
  if (tripStopIds.length === 0) return
  try {
    await api.put(`/driver/trips/${tripId}/stop-order`, { trip_stop_ids: tripStopIds })
  } catch { /* offline or refused: the local order still applies */ }
}

export async function loadStopOrder(tripId: string): Promise<string[] | null> {
  try {
    const raw = await AsyncStorage.getItem(key(tripId))
    const ids = raw ? JSON.parse(raw) : null
    return Array.isArray(ids) ? ids : null
  } catch {
    return null
  }
}

export async function clearStopOrders(tripIds: string[]): Promise<void> {
  try {
    await AsyncStorage.multiRemove(tripIds.map(key))
  } catch { /* non-fatal */ }
}

/** `list` with the item at `from` moved to `to` (to < from), the rest shifted down one. */
export function moveEarlier<T>(list: T[], from: number, to: number): T[] {
  if (from <= to || from >= list.length) return list
  const next = [...list]
  const [item] = next.splice(from, 1)
  next.splice(to, 0, item)
  return next
}
