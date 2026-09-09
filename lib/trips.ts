import api from './api/auth.api'
import AsyncStorage from '@react-native-async-storage/async-storage'

import { pendingConfirmations } from './offlineQueue'

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
  const overlay = async (trips: Trip[]) =>
    applyPendingConfirmations(trips, await pendingConfirmations().catch(
      () => ({ loadedTripIds: [], confirmedStopIds: [] }),
    ))

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

  return trips.map((trip) => {
    const stops = (trip.booking_trip_stops ?? []).map((stop) =>
      stop.status === 'pending' && confirmed.has(stop.trip_stop_id)
        ? { ...stop, status: 'delivered' as const }
        : stop,
    )

    const allDone = stops.length > 0 && stops.every(
      (s) => s.status === 'delivered' || s.status === 'failed',
    )

    let status = trip.status
    if (status === 'pending' && loaded.has(trip.trip_id)) status = 'in_transit'
    if (status !== 'cancelled' && allDone)                status = 'completed'

    return { ...trip, status, booking_trip_stops: stops }
  })
}
