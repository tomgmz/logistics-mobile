import { useCallback, useEffect, useRef, useState } from 'react'
import NetInfo, { NetInfoState } from '@react-native-community/netinfo'

import api from '../lib/api/auth.api'
import type { BookingRoute, LatLng, Stop } from '../types/navigation.types'
import {
  decodePolyline,
  buildTrafficSegments,
  stripHtml,
  distanceToPolyline,
  haversineDistance,
} from '../utils/geo'
import { saveRouteCache, loadRouteCache, ensureOfflinePack } from '../utils/cache'
import {
  ROUTE_REFRESH_MS,
  OFF_ROUTE_M,
  OFF_ROUTE_HOLD_MS,
  STEP_ADVANCE_M,
} from '../theme/navigation.theme'

const ARRIVAL_PROXIMITY_M = 50   // auto-detect threshold
const MANUAL_BUTTON_M     = 200  // show manual button within 200m

interface UseRouteOptions {
  bookingId:       string
  userLocation:    LatLng | null
  userLocationRef: React.MutableRefObject<LatLng | null>
  mapReady:        boolean
  onRouteReady:    (polyline: LatLng[]) => void
  onArrival?:      (type: 'pickup' | 'dropoff', stopId?: string) => void
}

interface UseRouteReturn {
  routeData:         BookingRoute | null
  displayPolyline:   LatLng[]
  loading:           boolean
  error:             string | null
  isOffline:         boolean
  usingCache:        boolean
  isRerouting:       boolean
  currentStep:       number
  setCurrentStep:    React.Dispatch<React.SetStateAction<number>>
  fetchRoute:        (isRefresh?: boolean, silent?: boolean, fastMode?: boolean) => Promise<void>
  onLocationUpdate:  (pos: LatLng) => void
  // Manual confirm
  nearbyTarget:      'pickup' | 'dropoff' | null
  distanceToTarget:  number
  markPickupArrived: () => void
  markStopArrived:   (stopId: string) => void
}

function closestPointIndex(pos: LatLng, points: LatLng[]): number {
  let minDist = Infinity
  let minIdx  = 0
  for (let i = 0; i < points.length; i++) {
    const d = haversineDistance(pos, points[i])
    if (d < minDist) { minDist = d; minIdx = i }
  }
  return minIdx
}

export function useRoute({
  bookingId,
  userLocation,
  userLocationRef,
  mapReady,
  onRouteReady,
  onArrival,
}: UseRouteOptions): UseRouteReturn {
  const [routeData,        setRouteData]        = useState<BookingRoute | null>(null)
  const [displayPolyline,  setDisplayPolyline]  = useState<LatLng[]>([])
  const [loading,          setLoading]          = useState(true)
  const [error,            setError]            = useState<string | null>(null)
  const [isOffline,        setIsOffline]        = useState(false)
  const [usingCache,       setUsingCache]       = useState(false)
  const [isRerouting,      setIsRerouting]      = useState(false)
  const [currentStep,      setCurrentStep]      = useState(0)
  const [nearbyTarget,     setNearbyTarget]     = useState<'pickup' | 'dropoff' | null>(null)
  const [distanceToTarget, setDistanceToTarget] = useState(0)

  const isOfflineRef     = useRef(isOffline)
  const hasFetchedRef    = useRef(false)
  const fetchRouteRef    = useRef<((isRefresh?: boolean, silent?: boolean, fastMode?: boolean) => Promise<void>) | null>(null)
  const offRouteSinceRef = useRef<number | null>(null)
  const routeDataRef     = useRef<BookingRoute | null>(null)
  const currentStepRef   = useRef(0)
  const pendingFitRef    = useRef<LatLng[] | null>(null)
  const arrivedPickupRef = useRef(false)
  const arrivedStopIds   = useRef<Set<string>>(new Set())
  const lastSnapIdxRef   = useRef(0)

  useEffect(() => { isOfflineRef.current  = isOffline  }, [isOffline])
  useEffect(() => { routeDataRef.current  = routeData  }, [routeData])
  useEffect(() => { currentStepRef.current = currentStep }, [currentStep])

  useEffect(() => {
    NetInfo.fetch().then((s: NetInfoState) => {
      const offline = !s.isConnected
      setIsOffline(offline)
      isOfflineRef.current = offline
    })
    const unsub = NetInfo.addEventListener((s: NetInfoState) => {
      const offline = !s.isConnected
      setIsOffline(offline)
      isOfflineRef.current = offline
      if (!offline && fetchRouteRef.current) fetchRouteRef.current(true, true)
    })
    return () => unsub()
  }, [])

  const fetchRoute = useCallback(async (
    isRefresh = false,
    silent    = false,
    fastMode  = false,
  ) => {
    if (isOfflineRef.current && isRefresh) return

    if (!isRefresh && !silent) {
      setLoading(true)
      setError(null)
    }
    if (isRerouting) setIsRerouting(false)

    if (isOfflineRef.current && !isRefresh) {
      const cached = await loadRouteCache(bookingId)
      if (cached) {
        setRouteData(cached)
        setDisplayPolyline(cached.polyline)
        setUsingCache(true)
        setLoading(false)
        lastSnapIdxRef.current = 0
        if (mapReady) onRouteReady(cached.polyline)
        else pendingFitRef.current = cached.polyline
        return
      }
      setError('No internet connection and no cached route available.')
      setLoading(false)
      return
    }

    const driverPos = userLocationRef.current
    if (!driverPos) {
      const cached = await loadRouteCache(bookingId)
      if (cached) {
        setRouteData(cached)
        setDisplayPolyline(cached.polyline)
        setUsingCache(true)
        setLoading(false)
        lastSnapIdxRef.current = 0
        if (mapReady) onRouteReady(cached.polyline)
        else pendingFitRef.current = cached.polyline
        return
      }
      setError('Could not get your location. Make sure GPS is on and try again.')
      setLoading(false)
      return
    }

    try {
      const bookingRes = await api.get(`/booking/${bookingId}`)
      const booking    = bookingRes.data.data

      const pickup = {
        latitude:  booking.origin_latitude  as number,
        longitude: booking.origin_longitude as number,
        address:   booking.origin           as string,
      }

      if (!pickup.latitude || !pickup.longitude)
        throw new Error('Booking is missing origin coordinates')

      const allStops: Stop[] = (booking.booking_destinations ?? [])
        .filter((d: any) => d.latitude != null && d.longitude != null)
        .sort((a: any, b: any) => a.sequence_order - b.sequence_order)
        .map((d: any): Stop => ({
          destination_id:           d.destination_id,
          address:                  d.address,
          latitude:                 d.latitude,
          longitude:                d.longitude,
          optimized_sequence_order: d.sequence_order,
          status:                   d.status,
          notes:                    d.notes ?? null,
        }))

      if (!allStops.length) throw new Error('No stops with coordinates found')

      const isPickedUp   = ['in_transit', 'completed'].includes(booking.status)
      const pendingStops = allStops.filter((s) => s.status === 'pending')

      if (isPickedUp) arrivedPickupRef.current = true

      if (pendingStops.length === 0 && isPickedUp) {
        setRouteData((prev) => (prev ? { ...prev, stops: allStops } : null))
        if (!isRefresh && !silent) setLoading(false)
        return
      }

      const waypointsAfterDriver: LatLng[] = isPickedUp
        ? pendingStops.map((s) => ({ latitude: s.latitude, longitude: s.longitude }))
        : [
            { latitude: pickup.latitude, longitude: pickup.longitude },
            ...pendingStops.map((s) => ({ latitude: s.latitude, longitude: s.longitude })),
          ]

      const destination   = waypointsAfterDriver[waypointsAfterDriver.length - 1]
      const intermediates = waypointsAfterDriver.slice(0, -1)

      const directionsRes = await api.post('/directions', {
        origin:      { location: { latLng: { latitude: driverPos.latitude, longitude: driverPos.longitude } } },
        destination: { location: { latLng: destination } },
        ...(intermediates.length > 0 && {
          intermediates: intermediates.map((p) => ({ location: { latLng: p } })),
        }),
        travelMode:        'DRIVE',
        routingPreference: 'TRAFFIC_AWARE',
        routeModifiers:    { avoidFerries: false },
        units:             'METRIC',
        extraComputations: fastMode ? [] : ['TRAFFIC_ON_POLYLINE'],
      })

      const route = directionsRes.data.data.routes[0]

      const googlePolyline = decodePolyline(route.polyline.encodedPolyline)
      const snappedCoords  = fastMode ? undefined : (route.polyline._snappedCoords as LatLng[] | undefined)
      const fullPolyline   = snappedCoords?.length ? snappedCoords : googlePolyline

      const startIdx = closestPointIndex(driverPos, fullPolyline)
      const polyline = fullPolyline.slice(startIdx)
      lastSnapIdxRef.current = 0

      const totalMins = Math.round(parseInt(route.duration ?? '0') / 60)

      const rawIntervals     = route.travelAdvisory?.speedReadingIntervals ?? []
      const trimmedIntervals = rawIntervals
        .map((iv: any) => ({
          ...iv,
          startPolylinePointIndex: Math.max(0, (iv.startPolylinePointIndex ?? 0) - startIdx),
          endPolylinePointIndex:   Math.max(0, (iv.endPolylinePointIndex   ?? fullPolyline.length - 1) - startIdx),
        }))
        .filter((iv: any) =>
          iv.endPolylinePointIndex >= 0 &&
          iv.startPolylinePointIndex <= polyline.length - 1,
        )

      const trafficSegments = buildTrafficSegments(polyline, trimmedIntervals)

      const steps = (route.legs ?? []).flatMap((leg: any) =>
        (leg.steps ?? []).map((step: any) => ({
          instruction:   stripHtml(step.navigationInstruction?.instructions ?? step.localizedValues?.distance?.text ?? ''),
          distance:      step.localizedValues?.distance?.text       ?? '',
          duration:      step.localizedValues?.staticDuration?.text ?? '',
          maneuver:      step.navigationInstruction?.maneuver?.toLowerCase() ?? '',
          startLocation: {
            latitude:  step.startLocation?.latLng?.latitude  ?? 0,
            longitude: step.startLocation?.latLng?.longitude ?? 0,
          },
        })),
      )

      const newRoute: BookingRoute = {
        origin:         pickup,
        stops:          allStops,
        total_duration: totalMins,
        total_distance: parseFloat((route.distanceMeters / 1000).toFixed(1)) || 0,
        polyline,
        trafficSegments,
        steps,
      }

      setRouteData(newRoute)
      setDisplayPolyline(polyline)
      setUsingCache(false)
      setCurrentStep(0)
      offRouteSinceRef.current = null

      saveRouteCache(bookingId, newRoute)
      ensureOfflinePack(bookingId, [
        pickup,
        ...allStops.map((s) => ({ latitude: s.latitude, longitude: s.longitude })),
        ...fullPolyline,
      ])

      if (mapReady) onRouteReady(polyline)
      else pendingFitRef.current = polyline

    } catch (err: any) {
      console.log('[useRoute] ERROR:', err?.response?.status, err?.response?.data)
      if (!isRefresh && !silent) {
        const cached = await loadRouteCache(bookingId)
        if (cached) {
          setRouteData(cached)
          setDisplayPolyline(cached.polyline)
          setUsingCache(true)
          setLoading(false)
          if (mapReady) onRouteReady(cached.polyline)
          else pendingFitRef.current = cached.polyline
          return
        }
        setError(err?.response?.data?.message ?? err?.message ?? 'Failed to load route')
      }
    } finally {
      if (!isRefresh && !silent) setLoading(false)
      setIsRerouting(false)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookingId, mapReady])

  useEffect(() => { fetchRouteRef.current = fetchRoute }, [fetchRoute])

  useEffect(() => {
    if (!hasFetchedRef.current && userLocation) {
      hasFetchedRef.current = true
      fetchRoute(false, false)
    }
  }, [userLocation, fetchRoute])

  useEffect(() => {
    const t = setInterval(async () => {
      const state = await NetInfo.fetch()
      if (state.isConnected) fetchRoute(true, true)
    }, ROUTE_REFRESH_MS)
    return () => clearInterval(t)
  }, [fetchRoute])

  useEffect(() => {
    if (mapReady && pendingFitRef.current) {
      onRouteReady(pendingFitRef.current)
      pendingFitRef.current = null
    }
  }, [mapReady, onRouteReady])

  // ── Manual confirm handlers ──────────────────────────────────────────────

  const markPickupArrived = useCallback(() => {
    if (arrivedPickupRef.current) return
    arrivedPickupRef.current = true
    setNearbyTarget(null)
    onArrival?.('pickup')
    api.patch(`/booking/${bookingId}/status`, { status: 'in_transit' }).catch((e) =>
      console.warn('[manual] Failed to update booking status:', e),
    )
  }, [bookingId, onArrival])

  const markStopArrived = useCallback((stopId: string) => {
    if (arrivedStopIds.current.has(stopId)) return
    arrivedStopIds.current.add(stopId)
    setNearbyTarget(null)
    onArrival?.('dropoff', stopId)
    setRouteData((prev) =>
      prev
        ? {
            ...prev,
            stops: prev.stops.map((s) =>
              s.destination_id === stopId ? { ...s, status: 'delivered' } : s,
            ),
          }
        : null,
    )
    api
      .patch(`/booking-destinations/${stopId}/status`, { status: 'delivered' })
      .catch((e) => console.warn('[manual] Failed to update stop status:', e))
  }, [onArrival])

  // ── Location update (GPS tick) ───────────────────────────────────────────

  const onLocationUpdate = useCallback((pos: LatLng) => {
    const route = routeDataRef.current
    if (!route) return

    // 1. Trim polyline
    const poly        = route.polyline
    const searchStart = Math.max(0, lastSnapIdxRef.current - 5)
    let minDist       = Infinity
    let snapIdx       = lastSnapIdxRef.current
    for (let i = searchStart; i < poly.length; i++) {
      const d = haversineDistance(pos, poly[i])
      if (d < minDist) { minDist = d; snapIdx = i }
      else if (d > minDist + 20) break
    }
    lastSnapIdxRef.current = snapIdx
    setDisplayPolyline(poly.slice(snapIdx))

    // 2. Auto-advance TurnCard step
    if (route.steps.length) {
      const nextIdx = currentStepRef.current + 1
      if (nextIdx < route.steps.length) {
        const next = route.steps[nextIdx]
        if (next?.startLocation && haversineDistance(pos, next.startLocation) <= STEP_ADVANCE_M) {
          setCurrentStep(nextIdx)
        }
      }
    }

    // 3. Auto arrival detection (50m)
    if (!arrivedPickupRef.current && route.origin) {
      const d = haversineDistance(pos, route.origin)
      if (d <= ARRIVAL_PROXIMITY_M) {
        arrivedPickupRef.current = true
        setNearbyTarget(null)
        onArrival?.('pickup')
        api.patch(`/booking/${bookingId}/status`, { status: 'in_transit' }).catch((e) =>
          console.warn('[proximity] Failed to update booking status:', e),
        )
      }
    }

    const nextStop = route.stops.find((s) => s.status === 'pending')
    if (nextStop && !arrivedStopIds.current.has(nextStop.destination_id)) {
      const d = haversineDistance(pos, nextStop)
      if (d <= ARRIVAL_PROXIMITY_M) {
        arrivedStopIds.current.add(nextStop.destination_id)
        setNearbyTarget(null)
        onArrival?.('dropoff', nextStop.destination_id)
        setRouteData((prev) =>
          prev
            ? {
                ...prev,
                stops: prev.stops.map((s) =>
                  s.destination_id === nextStop.destination_id
                    ? { ...s, status: 'delivered' }
                    : s,
                ),
              }
            : null,
        )
        api
          .patch(`/booking-destinations/${nextStop.destination_id}/status`, { status: 'delivered' })
          .catch((e) => console.warn('[proximity] Failed to update stop status:', e))
      }
    }

    // 4. Manual button visibility (200m window)
    if (!arrivedPickupRef.current && route.origin) {
      const d = haversineDistance(pos, route.origin)
      if (d <= MANUAL_BUTTON_M) {
        setNearbyTarget('pickup')
        setDistanceToTarget(Math.round(d))
      } else {
        setNearbyTarget(null)
      }
    } else if (nextStop && !arrivedStopIds.current.has(nextStop.destination_id)) {
      const d = haversineDistance(pos, nextStop)
      if (d <= MANUAL_BUTTON_M) {
        setNearbyTarget('dropoff')
        setDistanceToTarget(Math.round(d))
      } else {
        setNearbyTarget(null)
      }
    } else {
      setNearbyTarget(null)
    }

    // 5. Off-route rerouting
    if (isOfflineRef.current) return
    const distOff = distanceToPolyline(pos, poly)
    if (distOff > OFF_ROUTE_M) {
      if (offRouteSinceRef.current === null) {
        offRouteSinceRef.current = Date.now()
      } else if (Date.now() - offRouteSinceRef.current >= OFF_ROUTE_HOLD_MS) {
        offRouteSinceRef.current = null
        setIsRerouting(true)
        fetchRoute(false, true, true)
      }
    } else {
      offRouteSinceRef.current = null
    }
  }, [bookingId, fetchRoute, onArrival])

  return {
    routeData,
    displayPolyline,
    loading,
    error,
    isOffline,
    usingCache,
    isRerouting,
    currentStep,
    setCurrentStep,
    fetchRoute,
    onLocationUpdate,
    nearbyTarget,
    distanceToTarget,
    markPickupArrived,
    markStopArrived,
  }
}