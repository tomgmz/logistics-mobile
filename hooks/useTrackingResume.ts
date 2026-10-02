import { useEffect, useRef } from 'react'
import { AppState } from 'react-native'

import { fetchDriverBookings } from '../lib/driverBookings'
import { fetchTripsWithCache, currentTrip } from '../lib/trips'
import { pendingConfirmations } from '../lib/offlineQueue'
import {
  startTracking,
  stopTracking,
  isTracking,
  explainTrackingDenied,
} from '../lib/locationTracking'

/**
 * Put live tracking back on for a delivery that is already under way.
 *
 * Tracking is started by one event — the driver confirming a run's pickup — and
 * nothing else. Everything that interrupts it after that left the customer's map
 * dark for the rest of the trip: the app being killed or updated, the driver
 * signing out and back in (sign-out stops the task), a pickup confirmed on a
 * build that predated tracking. So on every launch and every return to the
 * foreground this asks the server what the driver is actually doing and lines
 * the task up with it.
 *
 * Only a run that is OUT counts. A booking stays `in_transit` while the truck
 * drives back empty between runs, and tracking is deliberately off for that leg
 * (see `endTripLeg`) — it is not part of anyone's delivery.
 *
 * Acts on a fresh server answer only. The cached booking list can be hours old,
 * and starting or stopping someone's location sharing on a guess is the wrong
 * way round; the next foreground tries again.
 */
export function useTrackingResume(driverId: string | null) {
  const running = useRef(false)

  useEffect(() => {
    if (!driverId) return

    const check = async () => {
      if (running.current) return
      running.current = true
      try {
        const bookings = await fetchDriverBookings(driverId)
        const active   = bookings.find((b) => b.status === 'in_transit')

        if (!active) {
          // Nothing on the road, so nothing to share. Covers a task left running
          // by a trip that ended while the phone was off — unless a pickup is
          // still waiting in the offline queue: the server says `assigned` only
          // because it hasn't heard yet, and the tracking that pickup started is
          // exactly what should be running.
          const { loadedTripIds } = await pendingConfirmations()
          if (loadedTripIds.length === 0 && await isTracking()) await stopTracking()
          return
        }

        const { trips } = await fetchTripsWithCache(active.booking_id)
        const trip = currentTrip(trips)
        if (trip?.status !== 'in_transit') return

        const next = [...(trip.booking_trip_stops ?? [])]
          .filter((s) => s.status === 'pending')
          .sort((a, b) => a.sequence_order - b.sequence_order)[0]
        const dest = next?.booking_destinations
        const nextStop = dest?.latitude != null && dest?.longitude != null
          ? { latitude: dest.latitude, longitude: dest.longitude }
          : null

        const result = await startTracking(active.booking_id, nextStop)
        if (result === 'denied') explainTrackingDenied(active.booking_id)
      } catch {
        // Offline or the server is down: leave the task exactly as it is.
      } finally {
        running.current = false
      }
    }

    void check()
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void check()
    })
    return () => sub.remove()
  }, [driverId])
}
