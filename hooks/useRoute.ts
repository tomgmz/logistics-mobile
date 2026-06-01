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

const ARRIVAL_PROXIMITY_M = 50
const MANUAL_BUTTON_M     = 200

const STEP_REGRESS_M = 80

// Snap-jump guards: how far (in polyline points) the matched index may move in
// a single GPS update before we treat it as noise and refuse to advance/trim.
const SNAP_MAX_FWD_JUMP  = 25
const SNAP_MAX_BACK_JUMP = 8

interface UseRouteOptions {
  bookingId:       string
  userLocation:    LatLng | null
  userLocationRef: React.MutableRefObject<LatLng | null>
  headingRef:      React.MutableRefObject<number>
  mapReady:        boolean
  onRouteReady:    (polyline: LatLng[]) => void
  onArrival?:      (type: 'pickup' | 'dropoff', stopId?: string) => void
}

interface UseRouteReturn {
  routeData:         BookingRoute | null
  displayPolyline:   LatLng[]
  routeVersion:      number
  loading:           boolean
  error:             string | null
  isOffline:         boolean
  usingCache:        boolean
  isRerouting:       boolean
  currentStep:       number
  setCurrentStep:    React.Dispatch<React.SetStateAction<number>>
  fetchRoute:        (isRefresh?: boolean, silent?: boolean, fastMode?: boolean) => Promise<void>
  onLocationUpdate:  (pos: LatLng) => void
  nearbyTarget:      'pickup' | 'dropoff' | null
  distanceToTarget:  number
  markPickupArrived: () => void
  markStopArrived:   (stopId: string) => void
  deliveryError:      string | null
  clearDeliveryError: () => void
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
  headingRef,
  mapReady,
  onRouteReady,
  onArrival,
}: UseRouteOptions): UseRouteReturn {
  const [routeData,        setRouteData]        = useState<BookingRoute | null>(null)
  const [displayPolyline,  setDisplayPolyline]  = useState<LatLng[]>([])
  const [routeVersion,     setRouteVersion]     = useState(0)
  const [loading,          setLoading]          = useState(true)
  const [error,            setError]            = useState<string | null>(null)
  const [isOffline,        setIsOffline]        = useState(false)
  const [usingCache,       setUsingCache]       = useState(false)
  const [isRerouting,      setIsRerouting]      = useState(false)
  const [currentStep,      setCurrentStep]      = useState(0)
  const [nearbyTarget,     setNearbyTarget]     = useState<'pickup' | 'dropoff' | null>(null)
  const [distanceToTarget, setDistanceToTarget] = useState(0)
  const [deliveryError,    setDeliveryError]    = useState<string | null>(null)

  const isOfflineRef     = useRef(isOffline)
  const hasFetchedRef    = useRef(false)
  const fetchSeqRef      = useRef(0)
  const fetchRouteRef    = useRef<((isRefresh?: boolean, silent?: boolean, fastMode?: boolean) => Promise<void>) | null>(null)
  const offRouteSinceRef = useRef<number | null>(null)
  const routeDataRef     = useRef<BookingRoute | null>(null)
  const currentStepRef   = useRef(0)
  const pendingFitRef    = useRef<LatLng[] | null>(null)
  const arrivedPickupRef = useRef(false)
  const arrivedStopIds   = useRef<Set<string>>(new Set())
  const lastSnapIdxRef   = useRef(0)

  const pendingDeliveryRef = useRef<Set<string>>(new Set())

  useEffect(() => { isOfflineRef.current   = isOffline  }, [isOffline])
  useEffect(() => { routeDataRef.current   = routeData  }, [routeData])
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

    // Only the initial/manual load should re-fit the camera to the whole
    // route. Background refreshes and silent re-routes must not yank the
    // camera out of the driver's tracking view.
    const shouldFit = !isRefresh && !silent

    // Sequence guard: if a newer fetch starts while this one is in flight,
    // this (older) response must not overwrite the newer route.
    const mySeq = ++fetchSeqRef.current
    const isStale = () => mySeq !== fetchSeqRef.current

    if (!isRefresh && !silent) {
      setLoading(true)
      setError(null)
    }

    const applyCached = (cached: BookingRoute) => {
      if (isStale()) return
      if (cached.arrivedPickup) arrivedPickupRef.current = true
      setRouteData(cached)
      setDisplayPolyline(cached.polyline)
      setRouteVersion((v) => v + 1)
      setUsingCache(true)
      setLoading(false)
      lastSnapIdxRef.current = 0
      if (shouldFit) {
        if (mapReady) onRouteReady(cached.polyline)
        else pendingFitRef.current = cached.polyline
      }
    }

    if (isOfflineRef.current && !isRefresh) {
      const cached = await loadRouteCache(bookingId)
      if (cached) { applyCached(cached); return }
      if (!isStale()) {
        setError('No internet connection and no cached route available.')
        setLoading(false)
      }
      return
    }

    const driverPos = userLocationRef.current
    if (!driverPos) {
      const cached = await loadRouteCache(bookingId)
      if (cached) { applyCached(cached); return }
      if (!isStale()) {
        setError('Could not get your location. Make sure GPS is on and try again.')
        setLoading(false)
      }
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
        throw new Error('This booking is missing pickup coordinates. Run route optimization first to resolve addresses.')

      const allStops: Stop[] = (booking.booking_destinations ?? [])
        .filter((d: any) => d.latitude != null && d.longitude != null)
        .sort((a: any, b: any) => a.sequence_order - b.sequence_order)
        .map((d: any): Stop => {
          // Preserve locally-confirmed deliveries: a background refresh must not
          // downgrade a stop we've optimistically (or in-flight) marked
          // delivered just because the backend hasn't persisted it yet.
          const locallyDelivered =
            arrivedStopIds.current.has(d.destination_id) ||
            pendingDeliveryRef.current.has(d.destination_id)
          return {
            destination_id:           d.destination_id,
            address:                  d.address,
            latitude:                 d.latitude,
            longitude:                d.longitude,
            optimized_sequence_order: d.sequence_order,
            status:                   locallyDelivered ? 'delivered' : d.status,
            notes:                    d.notes ?? null,
          }
        })

      if (!allStops.length) throw new Error('No stops with coordinates found. Run route optimization first.')

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
        origin: {
          location: { latLng: { latitude: driverPos.latitude, longitude: driverPos.longitude } },
          sideOfRoad: true,
        },
        destination: { location: { latLng: destination } },
        ...(intermediates.length > 0 && {
          intermediates: intermediates.map((p) => ({ location: { latLng: p } })),
        }),
        travelMode:        'DRIVE',
        routingPreference: 'TRAFFIC_AWARE',
        routeModifiers:    { avoidFerries: false },
        units:             'METRIC',
        // fast mode tells the server to skip Mapbox snapping + traffic so the
        // re-route returns quickly; the client uses the raw Google polyline.
        fast:              fastMode,
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
        // Drop intervals that lie entirely behind the driver's start point.
        // Clamping their indices to 0 (below) would otherwise collapse them
        // into overlapping zero-region segments at the route start.
        .filter((iv: any) =>
          (iv.endPolylinePointIndex ?? fullPolyline.length - 1) > startIdx,
        )
        .map((iv: any) => ({
          ...iv,
          startPolylinePointIndex: Math.max(0, (iv.startPolylinePointIndex ?? 0) - startIdx),
          endPolylinePointIndex:   Math.max(0, (iv.endPolylinePointIndex   ?? fullPolyline.length - 1) - startIdx),
        }))
        .filter((iv: any) => iv.startPolylinePointIndex <= polyline.length - 1)

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

      // A newer fetch superseded this one while it was in flight — discard.
      if (isStale()) return

      setRouteData(newRoute)
      setDisplayPolyline(polyline)
      setUsingCache(false)
      setRouteVersion((v) => v + 1)
      setCurrentStep(0)
      offRouteSinceRef.current = null

      saveRouteCache(bookingId, { ...newRoute, arrivedPickup: arrivedPickupRef.current })
      ensureOfflinePack(
        bookingId,
        pickup,
        allStops.map((s) => ({ latitude: s.latitude, longitude: s.longitude })),
        fullPolyline,
      ).catch((e) => console.warn('[offline] tile pack failed:', e))

      if (shouldFit) {
        if (mapReady) onRouteReady(polyline)
        else pendingFitRef.current = polyline
      }

    } catch (err: any) {
      console.log('[useRoute] ERROR:', err?.response?.status, err?.response?.data)
      if (!isRefresh && !silent && !isStale()) {
        const cached = await loadRouteCache(bookingId)
        if (cached) { applyCached(cached); return }
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

  // Watchdog: if GPS never produces a fix, don't hang on the loading spinner
  // forever. After a grace period, run the fetch anyway so it falls back to a
  // cached route or surfaces a "could not get your location" error.
  useEffect(() => {
    if (hasFetchedRef.current) return
    const t = setTimeout(() => {
      if (!hasFetchedRef.current) {
        hasFetchedRef.current = true
        fetchRoute(false, false)
      }
    }, 12_000)
    return () => clearTimeout(t)
  }, [fetchRoute])

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

  const setStopStatus = useCallback((stopId: string, status: Stop['status']) => {
    setRouteData((prev) =>
      prev
        ? {
            ...prev,
            stops: prev.stops.map((s) =>
              s.destination_id === stopId ? { ...s, status } : s,
            ),
          }
        : null,
    )
  }, [])

  const commitPickup = useCallback(() => {
    if (arrivedPickupRef.current) return
    arrivedPickupRef.current = true
    setNearbyTarget(null)
    onArrival?.('pickup')
    api.patch(`/booking/${bookingId}/status`, { status: 'in_transit' }).catch((e) => {
      // Roll back so proximity / the manual button can retry instead of
      // silently leaving the backend on the wrong status.
      arrivedPickupRef.current = false
      setDeliveryError('Could not confirm pickup. It will retry automatically.')
      console.warn('[nav] Failed to update booking status:', e)
    })
  }, [bookingId, onArrival])

  const commitDelivery = useCallback((stopId: string) => {
    if (arrivedStopIds.current.has(stopId) || pendingDeliveryRef.current.has(stopId)) return
    pendingDeliveryRef.current.add(stopId)
    arrivedStopIds.current.add(stopId)
    setNearbyTarget(null)
    onArrival?.('dropoff', stopId)
    setStopStatus(stopId, 'delivered')
    api
      .patch(`/booking-destinations/${stopId}/status`, { status: 'delivered' })
      .catch((e) => {
        // Roll back the optimistic delivery so it isn't permanently stuck
        // "delivered" locally while the backend still shows it pending.
        arrivedStopIds.current.delete(stopId)
        setStopStatus(stopId, 'pending')
        setDeliveryError('Could not confirm a delivery. It will retry automatically.')
        console.warn('[nav] Failed to update stop status:', e)
      })
      .finally(() => {
        pendingDeliveryRef.current.delete(stopId)
      })
  }, [bookingId, onArrival, setStopStatus])

  const markPickupArrived = commitPickup
  const markStopArrived   = commitDelivery


  const onLocationUpdate = useCallback((pos: LatLng) => {
    const route = routeDataRef.current
    if (!route) return

    const poly = route.polyline

    // Snap to the route. Guard against a single noisy GPS fix teleporting the
    // match far ahead — the snap index only moves forward, so an unchecked jump
    // would permanently trim the route in front of the driver.
    const snap = distanceToPolyline(pos, poly, lastSnapIdxRef.current)
    const jump = snap.snapIdx - lastSnapIdxRef.current
    if (snap.distance <= OFF_ROUTE_M && jump <= SNAP_MAX_FWD_JUMP && jump >= -SNAP_MAX_BACK_JUMP) {
      lastSnapIdxRef.current = snap.snapIdx
    }
    setDisplayPolyline(poly.slice(lastSnapIdxRef.current))

    if (route.steps.length) {
      const nextIdx = currentStepRef.current + 1
      if (nextIdx < route.steps.length) {
        const next = route.steps[nextIdx]
        if (next?.startLocation && haversineDistance(pos, next.startLocation) <= STEP_ADVANCE_M) {
          setCurrentStep(nextIdx)
        }
      }

      const currIdx = currentStepRef.current
      if (currIdx > 0) {
        const curr = route.steps[currIdx]
        if (curr?.startLocation) {
          const distToCurr = haversineDistance(pos, curr.startLocation)
          if (distToCurr > STEP_REGRESS_M) {
            const prev = route.steps[currIdx - 1]
            if (prev?.startLocation) {
              const distToPrev = haversineDistance(pos, prev.startLocation)
              if (distToPrev < distToCurr * 0.7) {
                setCurrentStep(currIdx - 1)
              }
            }
          }
        }
      }
    }

    if (!arrivedPickupRef.current && route.origin) {
      const d = haversineDistance(pos, route.origin)
      if (d <= ARRIVAL_PROXIMITY_M) {
        commitPickup()
      }
    }

    const nextStop = route.stops.find((s) => s.status === 'pending')

    if (
      nextStop &&
      !arrivedStopIds.current.has(nextStop.destination_id) &&
      !pendingDeliveryRef.current.has(nextStop.destination_id)
    ) {
      const d = haversineDistance(pos, nextStop)
      if (d <= ARRIVAL_PROXIMITY_M) {
        commitDelivery(nextStop.destination_id)
      }
    }

    if (!arrivedPickupRef.current && route.origin) {
      const d = haversineDistance(pos, route.origin)
      if (d <= MANUAL_BUTTON_M) {
        setNearbyTarget('pickup')
        setDistanceToTarget(Math.round(d))
      } else {
        setNearbyTarget(null)
      }
    } else if (
      nextStop &&
      !arrivedStopIds.current.has(nextStop.destination_id) &&
      !pendingDeliveryRef.current.has(nextStop.destination_id)
    ) {
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

    if (isOfflineRef.current) return
    if (snap.distance > OFF_ROUTE_M) {
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
  }, [fetchRoute, commitPickup, commitDelivery])

  return {
    routeData,
    displayPolyline,
    routeVersion,
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
    deliveryError,
    clearDeliveryError: () => setDeliveryError(null),
  }
}