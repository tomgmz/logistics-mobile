import type { Trip, TripStop } from './trips'

/**
 * How a booking's cargo is shared between its trips — the phone's copy of the
 * server's rules (logistics-backend src/lib/trip-cargo.ts; keep the two the
 * same).
 *
 * The driver can load more or less than operations planned for a trip. The
 * server then moves the difference onto the later trips; this does the same on
 * the phone so that, in a dead zone, the next trip's route already shows what is
 * left — and the confirmations it queues name the same trips and stops the
 * server will have once the pickup syncs:
 *
 *   * loaded less  → the shortfall goes on the next trip (a new stop there if
 *                    needed, a new trip at the end if there is none);
 *   * loaded more  → the extra comes off the last trips first.
 *
 * Trips and stops created here have no server id yet. They get a local id that
 * names them the way the server can resolve them (see localTripId/localStopId).
 */

export interface CargoLine {
  item_id:        string
  destination_id: string
  /** The booked quantity; a line with none is one indivisible unit. */
  total:          number
}

export interface PlanCargo {
  item_id:     string
  planned_qty: number
  loaded_qty:  number | null
}

export interface PlanStop {
  destination_id: string
  cargo:          PlanCargo[]
}

export interface PlanTrip {
  trip_number: number
  started:     boolean
  stops:       PlanStop[]
}

const EPS = 1e-9

export const lineTotal = (quantity: number | null | undefined): number =>
  typeof quantity === 'number' && quantity > 0 ? quantity : 1

/** What a started trip took of a line: what was loaded, else what was planned. */
function takenOn(trip: PlanTrip, itemId: string): number {
  let sum = 0
  for (const s of trip.stops) for (const c of s.cargo) {
    if (c.item_id === itemId) sum += c.loaded_qty ?? c.planned_qty
  }
  return sum
}

function plannedOn(trip: PlanTrip, itemId: string): number {
  let sum = 0
  for (const s of trip.stops) for (const c of s.cargo) if (c.item_id === itemId) sum += c.planned_qty
  return sum
}

/** Set one line's planned quantity on a trip, adding or removing its stop/row as needed. */
function setPlanned(trip: PlanTrip, line: CargoLine, qty: number): void {
  let stop = trip.stops.find((s) => s.destination_id === line.destination_id)
  if (!stop) {
    if (qty <= EPS) return
    stop = { destination_id: line.destination_id, cargo: [] }
    trip.stops.push(stop)
  }
  const row = stop.cargo.find((c) => c.item_id === line.item_id)
  if (qty <= EPS) {
    stop.cargo = stop.cargo.filter((c) => c.item_id !== line.item_id)
  } else if (row) {
    row.planned_qty = qty
  } else {
    stop.cargo.push({ item_id: line.item_id, planned_qty: qty, loaded_qty: null })
  }
}

export class CargoLoadError extends Error {}

/**
 * Load trip `tripNumber` with `loaded` (item → quantity; items not named load as
 * planned) and reshape the later trips to carry the rest. Returns the new plan;
 * the input is not modified.
 *
 * Throws CargoLoadError when the driver claims more than is left of a line, or
 * loads nothing at all.
 */
export function rollCargo(
  plan:       PlanTrip[],
  lines:      CargoLine[],
  tripNumber: number,
  loaded:     Map<string, number>,
): PlanTrip[] {
  const trips = plan
    .map((t) => ({ ...t, stops: t.stops.map((s) => ({ ...s, cargo: s.cargo.map((c) => ({ ...c })) })) }))
    .sort((a, b) => a.trip_number - b.trip_number)
  const trip = trips.find((t) => t.trip_number === tripNumber)
  if (!trip) throw new CargoLoadError(`Trip ${tripNumber} is not on this booking`)

  const earlier = trips.filter((t) => t.started && t.trip_number !== tripNumber)
  const later   = trips.filter((t) => !t.started && t.trip_number > tripNumber)

  for (const line of lines) {
    const remaining = line.total - earlier.reduce((n, t) => n + takenOn(t, line.item_id), 0)
    const take      = loaded.has(line.item_id) ? loaded.get(line.item_id)! : plannedOn(trip, line.item_id)

    if (take < -EPS) throw new CargoLoadError('A loaded quantity cannot be negative')
    if (take > remaining + EPS) {
      throw new CargoLoadError(
        `Cannot load ${take} of a cargo line that has only ${Math.max(0, remaining)} left to deliver`,
      )
    }

    setPlanned(trip, line, take)
    const row = trip.stops.find((s) => s.destination_id === line.destination_id)
      ?.cargo.find((c) => c.item_id === line.item_id)
    if (row) row.loaded_qty = take

    // What the later trips must now carry between them.
    let diff = (remaining - take) - later.reduce((n, t) => n + plannedOn(t, line.item_id), 0)
    if (diff > EPS) {
      // Short: the next trip takes it, or a new one at the end.
      let next = later[0]
      if (!next) {
        next = { trip_number: Math.max(...trips.map((t) => t.trip_number)) + 1, started: false, stops: [] }
        trips.push(next)
        later.push(next)
      }
      setPlanned(next, line, plannedOn(next, line.item_id) + diff)
    } else if (diff < -EPS) {
      // Over: take it back from the last trips first.
      for (const t of [...later].reverse()) {
        if (diff >= -EPS) break
        const have = plannedOn(t, line.item_id)
        const cut  = Math.min(have, -diff)
        setPlanned(t, line, have - cut)
        diff += cut
      }
    }
  }

  for (const t of trips) if (!t.started) t.stops = t.stops.filter((s) => s.cargo.length > 0)
  if (trip.stops.length === 0) throw new CargoLoadError('Load at least one item for this trip')

  // Trips left with nothing to carry go. Only ever the last ones (see above).
  return trips.filter((t) => t.started || t === trip || t.stops.length > 0)
}

/* ── On the phone's trips ─────────────────────────────────────────────────── */

/** The id of a trip the phone added offline: booking + trip number. */
export const localTripId = (bookingId: string, tripNumber: number) => `local:${bookingId}:${tripNumber}`
/** The id of a stop the phone added offline: booking + trip number + drop-off. */
export const localStopId = (bookingId: string, tripNumber: number, destinationId: string) =>
  `local:${bookingId}:${tripNumber}:${destinationId}`

/** `local:<booking>:<trip>[:<destination>]` → its parts, or null for a server id. */
export function parseLocalId(id: string): { bookingId: string; tripNumber: number; destinationId?: string } | null {
  if (!id.startsWith('local:')) return null
  const [, bookingId, n, destinationId] = id.split(':')
  const tripNumber = Number(n)
  if (!bookingId || !Number.isInteger(tripNumber)) return null
  return { bookingId, tripNumber, ...(destinationId ? { destinationId } : {}) }
}

const isStarted = (t: Trip) => t.status === 'in_transit' || t.status === 'completed'

/** The cached trips in the shape the rules work on. */
export function toPlanTrips(trips: Trip[]): PlanTrip[] {
  return trips
    .filter((t) => t.status !== 'cancelled')
    .map((t) => ({
      trip_number: t.trip_number,
      started:     isStarted(t),
      stops: (t.booking_trip_stops ?? []).map((s) => ({
        destination_id: s.destination_id,
        cargo: (s.booking_trip_cargo ?? []).map((c) => ({
          item_id:     c.item_id,
          planned_qty: Number(c.planned_qty),
          loaded_qty:  c.loaded_qty == null ? null : Number(c.loaded_qty),
        })),
      })),
    }))
}

/** Whether this plan has quantities for every cargo line — only then is there anything to move. */
export function planCoversCargo(trips: Trip[], lines: CargoLine[]): boolean {
  if (lines.length === 0) return false
  const covered = new Set(trips.flatMap((t) => (t.booking_trip_stops ?? []).flatMap((s) => (s.booking_trip_cargo ?? []).map((c) => c.item_id))))
  return lines.every((l) => covered.has(l.item_id))
}

/**
 * Apply loads the driver confirmed on this phone (trip number → item → qty) to
 * trips the server still reports as not loaded. Trips the server already
 * loaded are left alone — the server has applied the same rules to them.
 * Never throws: a load that no longer fits the plan is skipped.
 */
export function applyLocalLoads(
  trips:  Trip[],
  lines:  CargoLine[],
  loads:  Record<string, Array<{ item_id: string; quantity: number }>>,
): Trip[] {
  let out = trips
  const numbers = Object.keys(loads).map(Number).filter(Number.isInteger).sort((a, b) => a - b)
  for (const n of numbers) {
    const trip = out.find((t) => t.trip_number === n)
    if (!trip || trip.status !== 'pending' || !planCoversCargo(out, lines)) continue
    try {
      const next = rollCargo(toPlanTrips(out), lines, n, new Map(loads[String(n)].map((l) => [l.item_id, l.quantity])))
      out = fromPlanTrips(out, next)
        // The phone loaded it, so it is out now — what the server will say too.
        .map((t) => (t.trip_number === n ? { ...t, status: 'in_transit' as const } : t))
    } catch { /* stale load against a re-planned trip: the server has the say */ }
  }
  return out
}

/** Write a reshaped plan back onto the cached trips, keeping every id that still exists. */
function fromPlanTrips(trips: Trip[], plan: PlanTrip[]): Trip[] {
  const bookingId = trips[0]?.booking_id ?? ''
  const destInfo  = new Map<string, TripStop['booking_destinations']>()
  for (const t of trips) for (const s of t.booking_trip_stops ?? []) {
    if (s.booking_destinations) destInfo.set(s.destination_id, s.booking_destinations)
  }

  return plan.map((p) => {
    const existing = trips.find((t) => t.trip_number === p.trip_number)
    if (p.started && existing) return existing
    const tripId = existing?.trip_id ?? localTripId(bookingId, p.trip_number)
    const stops  = existing?.booking_trip_stops ?? []
    let order    = stops.reduce((n, s) => Math.max(n, s.sequence_order), 0)

    const kept: TripStop[] = stops
      .filter((s) => s.status !== 'pending' || p.stops.some((ps) => ps.destination_id === s.destination_id))
      .map((s) => {
        const ps = p.stops.find((x) => x.destination_id === s.destination_id)
        if (!ps) return s
        return {
          ...s,
          booking_trip_cargo: ps.cargo.map((c) => ({
            trip_cargo_id: s.booking_trip_cargo?.find((r) => r.item_id === c.item_id)?.trip_cargo_id ?? `local:${c.item_id}`,
            item_id:       c.item_id,
            planned_qty:   c.planned_qty,
            loaded_qty:    c.loaded_qty,
          })),
        }
      })
    const added: TripStop[] = p.stops
      .filter((ps) => !stops.some((s) => s.destination_id === ps.destination_id))
      .map((ps) => ({
        trip_stop_id:    localStopId(bookingId, p.trip_number, ps.destination_id),
        trip_id:         tripId,
        destination_id:  ps.destination_id,
        sequence_order:  ++order,
        status:          'pending',
        delivered_at:    null,
        proof_photo_url: null,
        proof_at:        null,
        booking_destinations: destInfo.get(ps.destination_id) ?? null,
        booking_trip_cargo: ps.cargo.map((c) => ({
          trip_cargo_id: `local:${c.item_id}`,
          item_id:       c.item_id,
          planned_qty:   c.planned_qty,
          loaded_qty:    c.loaded_qty,
        })),
      }))

    return {
      ...(existing ?? {
        trip_id:                tripId,
        booking_id:             bookingId,
        trip_number:            p.trip_number,
        status:                 'pending' as const,
        pickup_proof_photo_url: null,
        pickup_proof_at:        null,
        notes:                  null,
      }),
      booking_trip_stops: [...kept, ...added],
    }
  })
}
