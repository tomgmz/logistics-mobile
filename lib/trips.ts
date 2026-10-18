import api from './api/auth.api'
import AsyncStorage from '@react-native-async-storage/async-storage'

import { pendingConfirmations } from './offlineQueue'
import { applyLocalLoads, localStopId, localTripId, type CargoLine } from './tripCargo'

/**
 * The runs the truck makes for one booking.
 *
 * A booking used to be one truckload — confirm the pickup once, work down the
 * drop-offs, done. When the cargo is bigger than the body it is the SAME vehicle
 * shuttling: load at the origin, run to a drop-off, come back empty, load again,
 * run again. Operations plans how many runs and which drop-offs each serves; the
 * driver works through them in order.
 *
 * The consequence that matters in the app: "confirm the pickup" happens once per
 * RUN, not once per booking, and each one needs its own photo. A drop-off that
 * takes two loads is not finished when the first one is unloaded.
 */

export type TripStatus     = 'pending' | 'in_transit' | 'completed' | 'cancelled'
export type TripStopStatus = 'pending' | 'delivered' | 'failed'

export interface TripStopDestination {
  destination_id: string
  address:        string
  sequence_order: number
  latitude:       number | null
  longitude:      number | null
  notes:          string | null
  status:         string
}

export interface TripStop {
  trip_stop_id:   string
  trip_id:        string
  destination_id: string
  sequence_order: number
  status:         TripStopStatus
  delivered_at:   string | null
  proof_photo_url: string | null
  proof_at:        string | null
  booking_destinations: TripStopDestination | null
  /** How much of each cargo line this stop unloads on this trip. Absent on older plans. */
  booking_trip_cargo?: TripCargo[]
}

/** One cargo line's share of one trip. */
export interface TripCargo {
  trip_cargo_id: string
  item_id:       string
  planned_qty:   number
  /** Null until the trip is loaded; what actually went on the truck. */
  loaded_qty:    number | null
}

export interface Trip {
  trip_id:     string
  booking_id:  string
  trip_number: number
  status:      TripStatus
  pickup_proof_photo_url: string | null
  pickup_proof_at:        string | null
  notes:       string | null
  booking_trip_stops: TripStop[]
}

export async function fetchTrips(bookingId: string): Promise<Trip[]> {
  const { data } = await api.get(`/driver/bookings/${bookingId}/trips`)
  return data.data ?? []
}

/* ── Offline copy ─────────────────────────────────────────────────────────── */

/**
 * The plan has to survive a dead zone.
 *
 * The whole point of the shuttle is that the driver is out of contact for long
 * stretches; if the trip list only existed on the server, a driver who lost
 * signal after loading run 2 would have no idea which bays that run is for.
 * Cached on every successful fetch, read when the fetch fails.
 */
const cacheKey = (bookingId: string) => `trips_${bookingId}`

export async function saveTripsCache(bookingId: string, trips: Trip[]): Promise<void> {
  try {
    await AsyncStorage.setItem(cacheKey(bookingId), JSON.stringify(trips))
  } catch { /* non-fatal */ }
}

export async function loadTripsCache(bookingId: string): Promise<Trip[] | null> {
  try {
    const raw = await AsyncStorage.getItem(cacheKey(bookingId))
    return raw ? (JSON.parse(raw) as Trip[]) : null
  } catch {
    return null
  }
}

/* ── What this phone has confirmed ─────────────────────────────────────────── */

/**
 * Every pickup and drop-off confirmed on this phone, per booking — kept after the
 * queue has sent it.
 *
 * The queue alone is not enough. A stop confirmed ONLINE leaves the queue within
 * a second, but the trips cache still holds the answer from when the map opened,
 * with that stop pending. Rebuild the route from cache + queue in a dead zone at
 * the end of a run and the stop comes back to life: the driver is sent back to a
 * bay they emptied an hour ago. This record closes that gap. It only ever moves a
 * stop from pending to done, never the other way, so a stale entry cannot undo
 * anything the server says.
 */
const progressKey = (bookingId: string) => `trip_progress_${bookingId}`

/** What the driver loaded at a pickup, when it differed from the plan. */
export interface LocalLoad {
  tripNumber: number
  loaded:     Array<{ item_id: string; quantity: number }>
  /** The booking's cargo lines at the time, so the rest can be re-planned offline. */
  lines:      CargoLine[]
}

interface LocalProgress {
  loadedTripIds:    string[]
  confirmedStopIds: string[]
  loads:            LocalLoad[]
}

export async function loadLocalProgress(bookingId: string): Promise<LocalProgress> {
  try {
    const raw = await AsyncStorage.getItem(progressKey(bookingId))
    const p = raw ? (JSON.parse(raw) as Partial<LocalProgress>) : {}
    return { loadedTripIds: p.loadedTripIds ?? [], confirmedStopIds: p.confirmedStopIds ?? [], loads: p.loads ?? [] }
  } catch {
    return { loadedTripIds: [], confirmedStopIds: [], loads: [] }
  }
}

export async function recordLocalProgress(
  bookingId: string,
  entry: { loadedTripId?: string; confirmedStopId?: string; load?: LocalLoad },
): Promise<void> {
  try {
    const p = await loadLocalProgress(bookingId)
    if (entry.loadedTripId && !p.loadedTripIds.includes(entry.loadedTripId)) p.loadedTripIds.push(entry.loadedTripId)
    if (entry.confirmedStopId && !p.confirmedStopIds.includes(entry.confirmedStopId)) p.confirmedStopIds.push(entry.confirmedStopId)
    if (entry.load) {
      const load = entry.load
      p.loads = [...p.loads.filter((l) => l.tripNumber !== load.tripNumber), load]
    }
    await AsyncStorage.setItem(progressKey(bookingId), JSON.stringify(p))
  } catch { /* the queue still carries it */ }
}

export async function clearLocalProgress(bookingId: string): Promise<void> {
  try { await AsyncStorage.removeItem(progressKey(bookingId)) } catch { /* non-fatal */ }
}

/**
 * Fetch, caching on success and falling back to the cache on failure — then fold
 * in whatever the driver has confirmed that has not reached the server yet.
 *
 * That last step is not optional, and it is why callers should use this rather
 * than `fetchTrips`. A fresh, successful fetch is just as stale as the cache
 * while confirmations are sitting in the offline queue: the server answers
 * honestly about what it knows, and what it knows is behind the driver.
 */
export async function fetchTripsWithCache(bookingId: string): Promise<{ trips: Trip[]; fromCache: boolean }> {
  // Two sources of "done on this phone": the queue (not sent yet) and the local
  // progress record (sent, but possibly after the cache was last refreshed).
  const overlay = async (served: Trip[]) => {
    let trips = served
    const queued = await pendingConfirmations().catch(
      () => ({ loadedTripIds: [], confirmedStopIds: [] }),
    )
    const local = await loadLocalProgress(bookingId)
    // Loads first: they can add the stops and trips the confirmations name.
    if (local.loads.length > 0) {
      const lines = local.loads[local.loads.length - 1].lines
      const loads = Object.fromEntries(local.loads.map((l) => [String(l.tripNumber), l.loaded]))
      trips = applyLocalLoads(trips, lines, loads)
    }
    return applyPendingConfirmations(trips, {
      loadedTripIds:    [...queued.loadedTripIds,    ...local.loadedTripIds],
      confirmedStopIds: [...queued.confirmedStopIds, ...local.confirmedStopIds],
    })
  }

  try {
    const trips = await fetchTrips(bookingId)
    // Cached BEFORE the overlay: the cache should hold the server's own answer,
    // so the queue's contribution is applied once on read and never baked in
    // and double-counted after it drains.
    await saveTripsCache(bookingId, trips)
    return { trips: await overlay(trips), fromCache: false }
  } catch (err) {
    const cached = await loadTripsCache(bookingId)
    if (cached) return { trips: await overlay(cached), fromCache: true }
    throw err
  }
}

/* ── Reading the plan ─────────────────────────────────────────────────────── */

const isOpen = (t: Trip) => t.status !== 'completed' && t.status !== 'cancelled'

/** The trips the driver still has to run, in order. */
export function remainingTrips(trips: Trip[]): Trip[] {
  return trips.filter(isOpen).sort((a, b) => a.trip_number - b.trip_number)
}

/**
 * The run the driver is on, or the next one to load.
 *
 * A trip already `in_transit` wins over a later `pending` one: the truck is out
 * with that load on it, and nothing else can start until it comes back.
 */
export function currentTrip(trips: Trip[]): Trip | null {
  const open = remainingTrips(trips)
  return open.find((t) => t.status === 'in_transit') ?? open[0] ?? null
}

/** Progress across the whole booking, counting every visit rather than every bay. */
export function tripProgressCounts(trips: Trip[]) {
  const stops = trips
    .filter((t) => t.status !== 'cancelled')
    .flatMap((t) => t.booking_trip_stops ?? [])

  const done  = stops.filter((s) => s.status === 'delivered' || s.status === 'failed').length
  const total = stops.length

  const runs      = trips.filter((t) => t.status !== 'cancelled')
  const runsDone  = runs.filter((t) => t.status === 'completed').length

  return { done, total, runsDone, runsTotal: runs.length }
}

/**
 * Whether a booking is really a shuttle.
 *
 * One trip over every drop-off is what a booking looked like before trips
 * existed, and it is what `ensurePlan` creates for one that was never planned.
 * The app should not put trip chrome on the screen for that — it would be
 * ceremony around a fact the driver already knows.
 */
export function isMultiTrip(trips: Trip[]): boolean {
  return trips.filter((t) => t.status !== 'cancelled').length > 1
}

/**
 * Fold in what the driver has confirmed but the server has not yet been told.
 *
 * Between a confirmation and its flush the server still reports the stop as
 * pending — in a dead zone, for hours. Rebuilding a route from that answer would
 * send the driver back to a bay they have already emptied, which is both wrong
 * and the exact moment they are least able to argue with the phone.
 *
 * The offline queue is where that knowledge lives (see
 * offlineQueue.pendingConfirmations), so this takes it as ids rather than
 * keeping a second copy that could disagree with the queue it mirrors.
 *
 * A trip whose every stop is locally confirmed is treated as completed, which is
 * what the server will conclude the moment the queue drains.
 */
export function applyPendingConfirmations(
  trips: Trip[],
  pending: { loadedTripIds: string[]; confirmedStopIds: string[] },
): Trip[] {
  const loaded    = new Set(pending.loadedTripIds)
  const confirmed = new Set(pending.confirmedStopIds)
  if (loaded.size === 0 && confirmed.size === 0) return trips

  // A trip or stop the phone created offline was confirmed under its local id
  // (tripCargo.localTripId / localStopId); once synced it has a server id. Match
  // it either way, or a synced roll-over stop would come back to life.
  return trips.map((trip) => {
    const stops = (trip.booking_trip_stops ?? []).map((stop) =>
      stop.status === 'pending' &&
      (confirmed.has(stop.trip_stop_id) ||
       confirmed.has(localStopId(trip.booking_id, trip.trip_number, stop.destination_id)))
        ? { ...stop, status: 'delivered' as const }
        : stop,
    )

    const allDone = stops.length > 0 && stops.every(
      (s) => s.status === 'delivered' || s.status === 'failed',
    )

    let status = trip.status
    if (status === 'pending' &&
        (loaded.has(trip.trip_id) || loaded.has(localTripId(trip.booking_id, trip.trip_number)))) status = 'in_transit'
    if (status !== 'cancelled' && allDone)                status = 'completed'

    return { ...trip, status, booking_trip_stops: stops }
  })
}
