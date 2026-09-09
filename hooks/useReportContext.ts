import { useEffect, useState } from 'react'
import * as Location from 'expo-location'

import { readCurrentFix } from '../lib/stopGeofence'
import { useAuthStore } from '../lib/store/auth.store'
import { loadBookingCache } from '../lib/navCache'
import api from '../lib/api/auth.api'

/**
 * The four facts every report opens with: where, which truck, and who.
 *
 * The design shows these as a read-only DETAILS panel above the form, and that
 * is the whole idea behind the quick alert — the useful part of an emergency
 * report is already known before the driver types anything, so a one-tap alert
 * is not an empty alert.
 *
 * Every field is independently optional and nothing here throws. A driver with
 * no GPS fix, or in the yard between jobs with no booking, must still be able to
 * raise something; a report that failed to send because the reverse geocoder was
 * slow is the worst possible outcome for this screen.
 */

export interface ReportContext {
  latitude:   number | null
  longitude:  number | null
  accuracy_m: number | null
  /** Reverse-geocoded street address, when one could be read. */
  address:    string | null
  plate:      string | null
  vehicle:    string | null
  driverName: string | null
  driverId:   string | null
  /** Still reading the position — the panel shows a placeholder meanwhile. */
  locating:   boolean
}

export function useReportContext(bookingId?: string | null): ReportContext {
  const user = useAuthStore((s) => s.user)

  const [fix, setFix]         = useState<{ latitude: number; longitude: number; accuracy_m: number | null } | null>(null)
  const [address, setAddress] = useState<string | null>(null)
  const [locating, setLocating] = useState(true)
  const [vehicle, setVehicle] = useState<{ plate: string | null; model: string | null }>({ plate: null, model: null })

  // Position first, address second. The coordinates are what the report actually
  // needs — the address is a courtesy for whoever reads it — so the two are not
  // awaited together: a slow geocoder must not delay the fix.
  useEffect(() => {
    let cancelled = false

    ;(async () => {
      const f = await readCurrentFix()
      if (cancelled) return
      setFix(f)
      setLocating(false)
      if (!f) return

      try {
        const places = await Location.reverseGeocodeAsync({
          latitude:  f.latitude,
          longitude: f.longitude,
        })
        if (cancelled) return
        const p = places?.[0]
        if (!p) return
        setAddress(
          [p.name, p.street, p.district, p.city, p.region]
            .filter(Boolean)
            .filter((v, i, a) => a.indexOf(v) === i)
            .join(', ') || null,
        )
      } catch { /* the coordinates stand on their own */ }
    })()

    return () => { cancelled = true }
  }, [])

  // Which truck. Read from the booking's assignment, falling back to the offline
  // copy — this runs in exactly the situations where the network is least
  // trustworthy, which is the point of the cache being there.
  useEffect(() => {
    if (!bookingId) return
    let cancelled = false

    ;(async () => {
      let booking: any = null
      try {
        const { data } = await api.get(`/booking/${bookingId}`)
        booking = data.data
      } catch {
        booking = await loadBookingCache<any>(bookingId)
      }
      if (cancelled || !booking) return

      const truck = booking.truck_assignments?.[0]?.trucks
      setVehicle({
        plate: truck?.plate_number ?? null,
        model: truck?.truck_models?.name ?? truck?.truck_models?.vehicle_type ?? booking.truck_type_needed ?? null,
      })
    })()

    return () => { cancelled = true }
  }, [bookingId])

  const driverName = user
    ? `${user.first_name ?? ''} ${user.last_name ?? ''}`.trim() || user.username || null
    : null

  return {
    latitude:   fix?.latitude ?? null,
    longitude:  fix?.longitude ?? null,
    accuracy_m: fix?.accuracy_m ?? null,
    address,
    plate:      vehicle.plate,
    vehicle:    vehicle.model,
    driverName,
    driverId:   (user as any)?.drivers?.driver_id ?? null,
    locating,
  }
}
