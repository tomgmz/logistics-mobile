import type { Waypoint } from '@googlemaps/react-native-navigation-sdk'

import type { Leg, DisplayStop } from './navSession'
import { currentTrip, isMultiTrip, type Trip } from './trips'

/**
 * What the navigation SDK is asked to drive, for the run the driver is on.
 *
 * The route is built ONE RUN AT A TIME, and this is the important consequence of
 * the shuttle model. A booking of three runs is not a nine-stop route; it is
 * three short routes, each starting at the origin, and the truck comes back
 * between them. Handing the SDK every bay at once would draw a route the driver
 * cannot drive — it would send them from the last bay of run 1 straight to the
 * first bay of run 2, skipping the reload that is the entire point.
 *
 * So: the pickup (unless this run is already loaded), then this run's own
 * outstanding bays. When the run finishes, the screen rebuilds against the next
 * one.
 *
 * Both nav providers derive their route through here, so the Google and Mapbox
 * screens cannot drift apart on the thing that decides where the truck goes.
 */

export interface BookingLike {
  origin?:           string | null
  origin_latitude?:  number | null
  origin_longitude?: number | null
}

export interface NavPlan {
  waypoints: Waypoint[]
  legs:      Leg[]
  stops:     DisplayStop[]
  /** The run these legs belong to. Null when every run is done. */
  trip:      Trip | null
  /**
   * True when the booking is finished driving but still open — every bay on
   * every run is confirmed and only the completion tap remains. The caller
   * shows the map with the completion button rather than a dead-end error.
   */
  nothingToNavigate: boolean
}

const hasCoords = (lat?: number | null, lng?: number | null) =>
  lat != null && lng != null

export function buildNavPlan(booking: BookingLike, trips: Trip[]): NavPlan {
  const trip     = currentTrip(trips)
  const shuttle  = isMultiTrip(trips)
  // Only worth saying on a booking that really is a shuttle — labelling a
  // single-run job "TRIP 1 OF 1" is ceremony around a fact the driver knows.
  const tripLabel = shuttle && trip
    ? `TRIP ${trip.trip_number} OF ${trips.filter((t) => t.status !== 'cancelled').length}`
    : null

  if (!trip) {
    // Every run is done. Show the bays that were driven, so the completion
    // screen still lists something recognisable.
    const done = trips
      .flatMap((t) => t.booking_trip_stops ?? [])
      .map((s, i): DisplayStop => ({
        kind:    'dropoff',
        number:  i + 1,
        label:   `Drop-off ${i + 1}`,
        address: s.booking_destinations?.address ?? `Drop-off ${i + 1}`,
      }))

    return { waypoints: [], legs: [], stops: done, trip: null, nothingToNavigate: true }
  }

  const waypoints: Waypoint[]    = []
  const legs:      Leg[]         = []
  const stops:     DisplayStop[] = []

  // The origin is a stop on EVERY run, not just the first: the truck comes back
  // for the next load. It drops out only once this run's load is aboard.
  const needsPickup = trip.status === 'pending'
  if (needsPickup && hasCoords(booking.origin_latitude, booking.origin_longitude)) {
    waypoints.push({
      title:    'Pickup',
      position: { lat: booking.origin_latitude!, lng: booking.origin_longitude! },
    })
    legs.push({
      type:      'pickup',
      tripId:    trip.trip_id,
      latitude:  booking.origin_latitude,
      longitude: booking.origin_longitude,
    })
    stops.push({
      kind:    'pickup',
      label:   shuttle ? `Pickup (load ${trip.trip_number})` : 'Pickup',
      address: booking.origin ?? 'Pickup',
      tripLabel,
    })
  }

  const pending = [...(trip.booking_trip_stops ?? [])]
    .filter((s) => s.status === 'pending')
    .sort((a, b) => a.sequence_order - b.sequence_order)

  pending.forEach((stop, i) => {
    const d = stop.booking_destinations
    if (!hasCoords(d?.latitude, d?.longitude)) return

    waypoints.push({
      title:    d!.address ?? 'Stop',
      position: { lat: d!.latitude!, lng: d!.longitude! },
    })
    legs.push({
      type:          'dropoff',
      tripId:        trip.trip_id,
      tripStopId:    stop.trip_stop_id,
      destinationId: stop.destination_id,
      latitude:      d!.latitude,
      longitude:     d!.longitude,
    })
    stops.push({
      kind:    'dropoff',
      number:  i + 1,
      label:   `Drop-off ${i + 1}`,
      address: d!.address ?? `Drop-off ${i + 1}`,
      tripLabel,
    })
  })

  return {
    waypoints,
    legs,
    stops,
    trip,
    // The run is loaded and every bay on it is confirmed: there is nothing left
    // to drive on THIS run, and the caller rebuilds against the next one.
    nothingToNavigate: waypoints.length === 0,
  }
}
