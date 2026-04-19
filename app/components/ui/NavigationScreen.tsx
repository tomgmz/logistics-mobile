import MapLibreGL, { type CameraRef } from '@maplibre/maplibre-react-native'
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  ActivityIndicator,
  Animated,
  Dimensions,
  FlatList, 
  Modal,
  StatusBar,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'
import * as Location from 'expo-location'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { MotiView, AnimatePresence } from 'moti'
import { useRouter } from 'expo-router'
import {
  ArrowLeft,
  Navigation2,
  MapPin,
  ChevronDown,
  ChevronUp,
  Clock,
  Route as RouteIcon,
  CheckCircle2,
  AlertCircle,
  Truck,
  ArrowUp,
  ArrowUpLeft,
  ArrowUpRight,
  CornerUpLeft,
  CornerUpRight,
  RotateCcw,
  RefreshCw,
  WifiOff,
  PackageCheck,
  PackageX,
  RotateCw,
} from 'lucide-react-native'

import api from '../../../lib/api/auth.api'
import { saveRouteCache, loadRouteCache }         from '../../../lib/api/maps/routeCache'
import { computeRoute }                            from '../../../lib/api/maps/routingService'
import type { LatLng, RouteStep, TrafficSegment, Route } from '../../../lib/api/maps/routingService'
import {
  getConnectionStatus,
  subscribeToConnectivity,
  type ConnectionStatus,
} from '../../../lib/api/maps/connectivityService'
import {
  createOffRouteDetector,
  getNextStepIndex,
} from '../../../lib/api/maps/navigationEngine'

MapLibreGL.setAccessToken(null)

MapLibreGL.Logger.setLogCallback((log) => {
  const { level, tag, message } = log
  if (level === 'warning' && message.includes('Canceled')) return true
  if (__DEV__) console.log(`[MapLibre][${tag ?? 'general'}][${level}] ${message}`)
  return true
})

const { height: SH } = Dimensions.get('window')
const MAP_STYLE       = 'https://tiles.openfreemap.org/styles/bright'

const C = {
  bg:            '#0a0a0a',
  surface:       '#141414',
  surfaceHi:     '#1a1a1a',
  border:        '#2a2a2a',
  divider:       '#3a3a3a',

  white:         '#ffffff',
  dimWhite:      'rgba(255,255,255,0.55)',
  dimmer:        'rgba(255,255,255,0.25)',

  cyan:          '#00e5ff',
  cyanDim:       'rgba(0,229,255,0.12)',
  green:         '#3af626',
  orange:        '#f59e0b',
  red:           '#ef4444',
  purple:        '#a78bfa',

  overlay:       'rgba(0,0,0,0.85)',
  modalBg:       'rgba(0,0,0,0.7)',
  bannerBg:      '#0d2a2e',
  bannerBorder:  'rgba(0,229,255,0.25)',
  offlineBg:     '#1a1200',
  offlineBorder: 'rgba(245,158,11,0.35)',
  rerouteBg:     '#1a0d2e',
  rerouteBorder: 'rgba(167,139,250,0.35)',
}

interface Stop {
  destination_id:           string
  address:                  string
  latitude:                 number
  longitude:                number
  optimized_sequence_order: number
  status:                   'pending' | 'delivered' | 'failed'
  notes?:                   string | null
}

interface BookingRoute {
  origin:          { latitude: number; longitude: number; address: string }
  stops:           Stop[]
  total_duration:  number
  total_distance:  number
  polyline:        LatLng[]
  trafficSegments: TrafficSegment[]
  steps:           RouteStep[]
}

type Coord = [number, number]

function toCoord(p: LatLng): Coord { return [p.longitude, p.latitude] }

function trafficColor(speed: TrafficSegment['speed']): string {
  switch (speed) {
    case 'fast':   return '#22c55e'
    case 'normal': return '#22c55e'
    case 'slow':   return '#f59e0b'
    case 'jam':    return '#ef4444'
    default:       return '#22c55e'
  }
}

function toTrafficFeatures(
  segments: TrafficSegment[],
): GeoJSON.FeatureCollection<GeoJSON.LineString> {
  return {
    type:     'FeatureCollection',
    features: segments.map((seg, i) => ({
      type:       'Feature' as const,
      id:         String(i),
      geometry:   { type: 'LineString' as const, coordinates: seg.coords.map(toCoord) },
      properties: { color: trafficColor(seg.speed) },
    })),
  }
}

function fmtDuration(mins: number): string {
  if (mins < 60) return `${Math.round(mins)} min`
  const h = Math.floor(mins / 60)
  const m = Math.round(mins % 60)
  return m > 0 ? `${h}h ${m}m` : `${h}h`
}

function fmtDistance(km: number): string {
  return km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km`
}

async function ensureOfflinePack(bookingId: string, points: LatLng[]): Promise<void> {
  try {
    const name  = `trip_${bookingId}`
    const packs = await MapLibreGL.offlineManager.getPacks()
    if (packs.some((p: any) => p.name === name)) return
    const lngs  = points.map((p) => p.longitude)
    const lats  = points.map((p) => p.latitude)
    const ne: [number, number] = [Math.max(...lngs), Math.max(...lats)]
    const sw: [number, number] = [Math.min(...lngs), Math.min(...lats)]
    await MapLibreGL.offlineManager.createPack(
      { name, styleURL: MAP_STYLE, minZoom: 10, maxZoom: 16, bounds: [ne, sw] },
      (_r: any, status: any) => { if (__DEV__) console.log('[offline] pack progress:', status?.percentage) },
      (_r: any, err: any)    => { console.warn('[offline] pack error:', err) },
    )
  } catch (err) { console.warn('[offline] ensureOfflinePack failed:', err) }
}

function ManeuverIcon({ maneuver }: { maneuver?: string }) {
  const sz = 30, color = C.cyan, sw = 2.5
  if (!maneuver || maneuver.includes('straight') || maneuver === '')
    return <ArrowUp size={sz} color={color} strokeWidth={sw} />
  if (maneuver.includes('turn-left')    || maneuver === 'left')
    return <CornerUpLeft size={sz} color={color} strokeWidth={sw} />
  if (maneuver.includes('turn-right')   || maneuver === 'right')
    return <CornerUpRight size={sz} color={color} strokeWidth={sw} />
  if (maneuver.includes('slight-left')  || maneuver.includes('bear-left'))
    return <ArrowUpLeft size={sz} color={color} strokeWidth={sw} />
  if (maneuver.includes('slight-right') || maneuver.includes('bear-right'))
    return <ArrowUpRight size={sz} color={color} strokeWidth={sw} />
  if (maneuver.includes('uturn'))
    return <RotateCcw size={sz} color={color} strokeWidth={sw} />
  if (maneuver.includes('roundabout')   || maneuver.includes('rotary'))
    return <RefreshCw size={sz} color={color} strokeWidth={sw} />
  if (maneuver.includes('merge')        || maneuver.includes('ramp') || maneuver.includes('fork'))
    return <ArrowUpRight size={sz} color={color} strokeWidth={sw} />
  if (maneuver.includes('destination'))
    return <MapPin size={sz} color={C.orange} strokeWidth={sw} />
  return <ArrowUp size={sz} color={color} strokeWidth={sw} />
}

function StopRow({
  stop, isOrigin, isLast, isCurrent, onMark,
}: {
  stop:       Stop
  isOrigin?:  boolean
  isLast?:    boolean
  isCurrent?: boolean
  onMark?:    (id: string) => void
}) {
  const delivered = stop.status === 'delivered'
  const failed    = stop.status === 'failed'
  const dotColor  = isOrigin ? C.cyan : delivered ? C.green : failed ? C.red : isCurrent ? C.orange : C.dimmer
  const dotBg     = delivered ? C.green : failed ? C.red : 'transparent'

  return (
    <View style={{ flexDirection: 'row', gap: 12, minHeight: 56 }}>
      <View style={{ alignItems: 'center', width: 32 }}>
        <View style={{
          width: 28, height: 28, borderRadius: 14,
          borderWidth: 2, borderColor: dotColor, backgroundColor: dotBg,
          alignItems: 'center', justifyContent: 'center',
        }}>
          {delivered  && <CheckCircle2 size={10} color="#000" />}
          {failed     && <AlertCircle  size={10} color="#fff" />}
          {!delivered && !failed && isOrigin  && <Navigation2 size={10} color={C.cyan} />}
          {!delivered && !failed && !isOrigin && (
            <Text style={{ fontSize: 11, fontWeight: '900', color: dotColor }}>
              {stop.optimized_sequence_order}
            </Text>
          )}
        </View>
        {!isLast && (
          <View style={{
            flex: 1, width: 1, borderLeftWidth: 1, borderStyle: 'dashed',
            borderColor: delivered ? C.green : C.divider,
            marginVertical: 2, minHeight: 20,
          }} />
        )}
      </View>

      <View style={{ flex: 1, paddingTop: 4, paddingBottom: 12, flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 14, fontWeight: '600', color: isCurrent ? C.orange : C.white }} numberOfLines={2}>
            {stop.address}
          </Text>
          {isOrigin && (
            <Text style={{ fontSize: 11, marginTop: 2, color: C.dimWhite }}>Origin · Pickup</Text>
          )}
          {!isOrigin && (
            <Text style={{ fontSize: 11, marginTop: 2, color: delivered ? C.green : failed ? C.red : isCurrent ? C.orange : C.dimWhite }}>
              {delivered ? 'Delivered' : failed ? 'Failed' : isCurrent ? 'Next stop' : 'Pending'}
            </Text>
          )}
          {stop.notes ? (
            <Text style={{ fontSize: 11, marginTop: 2, color: C.dimmer }} numberOfLines={1}>
              {stop.notes}
            </Text>
          ) : null}
        </View>

        {isCurrent && !isOrigin && !delivered && !failed && onMark && (
          <TouchableOpacity
            onPress={() => onMark(stop.destination_id)}
            style={{
              paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8,
              backgroundColor: 'rgba(58,246,38,0.12)', borderWidth: 1, borderColor: C.green,
              flexDirection: 'row', alignItems: 'center', gap: 4,
            }}
          >
            <PackageCheck size={13} color={C.green} />
            <Text style={{ fontSize: 11, fontWeight: '700', color: C.green }}>Delivered</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  )
}

function MarkStopModal({
  stop, onConfirm, onClose,
}: {
  stop:      Stop | null
  onConfirm: (id: string, status: 'delivered' | 'failed') => void
  onClose:   () => void
}) {
  if (!stop) return null
  return (
    <Modal transparent animationType="fade" visible onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: C.modalBg, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <View style={{ backgroundColor: C.surface, borderRadius: 20, padding: 24, width: '100%', borderWidth: 1, borderColor: C.border }}>
          <Text style={{ color: C.white, fontSize: 16, fontWeight: '700', marginBottom: 4 }}>
            Mark Stop #{stop.optimized_sequence_order}
          </Text>
          <Text style={{ color: C.dimWhite, fontSize: 13, marginBottom: 20 }} numberOfLines={2}>
            {stop.address}
          </Text>

          <TouchableOpacity
            onPress={() => onConfirm(stop.destination_id, 'delivered')}
            style={{
              flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
              backgroundColor: 'rgba(58,246,38,0.12)', borderWidth: 1, borderColor: C.green,
              borderRadius: 12, paddingVertical: 14, marginBottom: 10,
            }}
          >
            <PackageCheck size={18} color={C.green} />
            <Text style={{ color: C.green, fontWeight: '700', fontSize: 15 }}>Mark as Delivered</Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() => onConfirm(stop.destination_id, 'failed')}
            style={{
              flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
              backgroundColor: 'rgba(239,68,68,0.12)', borderWidth: 1, borderColor: C.red,
              borderRadius: 12, paddingVertical: 14, marginBottom: 10,
            }}
          >
            <PackageX size={18} color={C.red} />
            <Text style={{ color: C.red, fontWeight: '700', fontSize: 15 }}>Mark as Failed</Text>
          </TouchableOpacity>

          <TouchableOpacity onPress={onClose} style={{ alignItems: 'center', paddingVertical: 12 }}>
            <Text style={{ color: C.dimWhite, fontSize: 14 }}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  )
}

function getBadgeUri(label: string, bg: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="44" height="52">
    <rect x="2" y="2" width="40" height="30" rx="15" ry="15" fill="${bg}" stroke="rgba(255,255,255,0.4)" stroke-width="2"/>
    <text x="22" y="18" font-family="Arial" font-size="14" font-weight="900" fill="${label === 'D' ? '#000000' : '#ffffff'}" text-anchor="middle" dominant-baseline="middle">${label}</text>
    <polygon points="16,30 28,30 22,44" fill="${bg}"/>
  </svg>`
  return `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`
}

const ETA_REFRESH_MS   = 30_000
const ROUTE_REFRESH_MS = 60_000
const MAP_VIEW_STYLE   = { position: 'absolute' as const, top: 0, left: 0, right: 0, bottom: 0 }

interface NavigationScreenProps {
  bookingId: string
}

export default function NavigationScreen({ bookingId }: NavigationScreenProps) {
  const insets    = useSafeAreaInsets()
  const router    = useRouter()
  const cameraRef = useRef<CameraRef>(null)

  const [routeData,    setRouteData]    = useState<BookingRoute | null>(null)
  const [loading,      setLoading]      = useState(true)
  const [error,        setError]        = useState<string | null>(null)
  const [userLocation, setUserLocation] = useState<LatLng | null>(null)
  const [heading,      setHeading]      = useState<number>(0)
  const [sheetOpen,    setSheetOpen]    = useState(false)
  const [currentStep,  setCurrentStep]  = useState(0)
  const [trackingMode, setTrackingMode] = useState(true)
  const [mapReady,     setMapReady]     = useState(false)
  const [connStatus,   setConnStatus]   = useState<ConnectionStatus>('online')
  const [usingCache,   setUsingCache]   = useState(false)
  const [isRerouting,  setIsRerouting]  = useState(false)
  const [liveEta,      setLiveEta]      = useState<number | null>(null)
  const [markingStop,  setMarkingStop]  = useState<Stop | null>(null)
  const [markingBusy,  setMarkingBusy]  = useState(false)

  const trackingModeRef   = useRef(trackingMode)
  const userLocationRef   = useRef<LatLng | null>(null)
  const hasFetchedRef     = useRef(false)
  const connStatusRef     = useRef<ConnectionStatus>('online')
  const fetchRouteRef     = useRef<((isRefresh?: boolean) => Promise<void>) | null>(null)
  const routeDataRef      = useRef<BookingRoute | null>(null)
  const fittedPolylineRef = useRef<LatLng[] | null>(null)
  const offRouteDetector  = useRef(createOffRouteDetector())
  const sheetAnim         = useRef(new Animated.Value(0)).current
  const routePendingFit   = useRef<LatLng[] | null>(null)

  useEffect(() => { trackingModeRef.current = trackingMode }, [trackingMode])
  useEffect(() => { connStatusRef.current   = connStatus   }, [connStatus])
  useEffect(() => { routeDataRef.current    = routeData    }, [routeData])

  useEffect(() => {
    getConnectionStatus().then(setConnStatus)
    return subscribeToConnectivity((status) => {
      setConnStatus(status)
      connStatusRef.current = status
      if (status === 'online' && fetchRouteRef.current) fetchRouteRef.current(true)
    })
  }, [])

  const fitMapToRoute = useCallback((polyline: LatLng[]) => {
    if (!polyline.length) return
    const lngs = polyline.map((p) => p.longitude)
    const lats  = polyline.map((p) => p.latitude)
    cameraRef.current?.fitBounds(
      [Math.max(...lngs), Math.max(...lats)],
      [Math.min(...lngs), Math.min(...lats)],
      [220, 60, 320, 60],
      800,
    )
    fittedPolylineRef.current = polyline
  }, [])

  const buildRouteFromApi = useCallback(async (
    driverPos:    LatLng,
    currentStops: Stop[],
    isPickedUp:   boolean,
    pickup:       { latitude: number; longitude: number; address: string },
  ): Promise<Omit<BookingRoute, 'origin' | 'stops'> | null> => {
    const pendingStops = currentStops.filter((s) => s.status === 'pending')
    if (!pendingStops.length) return null

    const waypoints: LatLng[] = isPickedUp
      ? pendingStops.map((s) => ({ latitude: s.latitude, longitude: s.longitude }))
      : [
          { latitude: pickup.latitude, longitude: pickup.longitude },
          ...pendingStops.map((s) => ({ latitude: s.latitude, longitude: s.longitude })),
        ]

    const destination   = waypoints[waypoints.length - 1]
    const intermediates = waypoints.slice(0, -1)
    const route         = await computeRoute({ origin: driverPos, destination, intermediates })

    return {
      total_duration:  Math.round(route.durationSeconds / 60),
      total_distance:  parseFloat((route.distanceMeters / 1000).toFixed(1)) || 0,
      polyline:        route.polyline,
      trafficSegments: route.trafficSegments,
      steps:           route.steps,
    }
  }, [])

  const fetchRoute = useCallback(async (isRefresh = false) => {
    const isOffline = connStatusRef.current !== 'online'
    if (isOffline && isRefresh) return
    if (!isRefresh) { setLoading(true); setError(null) }

    if (isOffline && !isRefresh) {
      const result = await loadRouteCache<BookingRoute>(bookingId)
      if (result.hit) {
        const route = result.data
        setRouteData(route); setUsingCache(true); setLoading(false)
        if (mapReady) fitMapToRoute(route.polyline)
        else routePendingFit.current = route.polyline
        return
      }
      setError('No internet connection and no cached route available.')
      setLoading(false)
      return
    }

    let driverPos = userLocationRef.current
    if (!driverPos) {
      for (let i = 0; i < 20; i++) {
        await new Promise((r) => setTimeout(r, 500))
        driverPos = userLocationRef.current
        if (driverPos) break
      }
    }

    if (!driverPos) {
      setError('Unable to acquire GPS location. Please check your settings.')
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

      const isPickedUp   = ['picked_up', 'in_transit', 'delivered'].includes(booking.status)
      const pendingStops = allStops.filter((s) => s.status === 'pending')

      if (pendingStops.length === 0 && isPickedUp) {
        setRouteData((prev) => prev ? { ...prev, stops: allStops } : null)
        if (!isRefresh) setLoading(false)
        return
      }

      const routeParts = await buildRouteFromApi(driverPos, allStops, isPickedUp, pickup)
      if (!routeParts) { if (!isRefresh) setLoading(false); return }

      const newRoute: BookingRoute = { origin: pickup, stops: allStops, ...routeParts }

      setRouteData(newRoute)
      setLiveEta(newRoute.total_duration)
      setUsingCache(false)
      setCurrentStep(0)
      setTrackingMode(false)

      saveRouteCache(bookingId, newRoute)
      ensureOfflinePack(bookingId, [
        pickup,
        ...allStops.map((s) => ({ latitude: s.latitude, longitude: s.longitude })),
        ...newRoute.polyline,
      ])

      if (fittedPolylineRef.current !== newRoute.polyline) {
        if (mapReady) fitMapToRoute(newRoute.polyline)
        else routePendingFit.current = newRoute.polyline
      }
    } catch (err: any) {
      if (!isRefresh) {
        const result = await loadRouteCache<BookingRoute>(bookingId)
        if (result.hit) {
          const route = result.data
          setRouteData(route); setUsingCache(true); setLoading(false)
          if (mapReady) fitMapToRoute(route.polyline)
          else routePendingFit.current = route.polyline
          return
        }
        setError(err?.response?.data?.message ?? err?.message ?? 'Failed to load route')
      }
    } finally {
      if (!isRefresh) setLoading(false)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookingId, fitMapToRoute, buildRouteFromApi, mapReady])

  const reroute = useCallback(async (driverPos: LatLng) => {
    if (connStatusRef.current !== 'online') return
    const current = routeDataRef.current
    if (!current) return

    setIsRerouting(true)
    offRouteDetector.current.resetCooldown()

    try {
      const routeParts = await buildRouteFromApi(driverPos, current.stops, true, current.origin)
      if (!routeParts) return
      const updated: BookingRoute = { ...current, ...routeParts }
      setRouteData(updated)
      setLiveEta(updated.total_duration)
      setCurrentStep(0)
      saveRouteCache(bookingId, updated)
      if (mapReady) fitMapToRoute(updated.polyline)
    } catch (err) {
      console.warn('[reroute] failed:', err)
    } finally {
      setIsRerouting(false)
    }
  }, [bookingId, buildRouteFromApi, fitMapToRoute, mapReady])

  useEffect(() => {
    let sub: Location.LocationSubscription | null = null
    ;(async () => {
      const { status } = await Location.requestForegroundPermissionsAsync()
      if (status !== 'granted') {
        setError('Location permission denied. Please enable it in settings.')
        setLoading(false)
        return
      }

      const last = await Location.getLastKnownPositionAsync()
      if (last) {
        const pos = { latitude: last.coords.latitude, longitude: last.coords.longitude }
        setUserLocation(pos); userLocationRef.current = pos
        setHeading(last.coords.heading ?? 0)
      }

      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced })
      const pos = { latitude: loc.coords.latitude, longitude: loc.coords.longitude }
      setUserLocation(pos); userLocationRef.current = pos
      setHeading(loc.coords.heading ?? 0)

      sub = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.BestForNavigation, timeInterval: 2000, distanceInterval: 5 },
        (loc) => {
          const pos = { latitude: loc.coords.latitude, longitude: loc.coords.longitude }
          setUserLocation(pos); userLocationRef.current = pos
          const hdg = loc.coords.heading ?? 0
          setHeading(hdg)

          if (trackingModeRef.current) {
            cameraRef.current?.setCamera({
              centerCoordinate: toCoord(pos),
              heading: hdg, pitch: 45, zoomLevel: 17, animationDuration: 500,
            })
          }

          const polyline = routeDataRef.current?.polyline
          if (polyline && offRouteDetector.current.check(pos, polyline)) reroute(pos)
        },
      )
    })()
    return () => { sub?.remove() }
  }, [reroute])

  useEffect(() => {
    if (!userLocation || !routeData?.steps.length) return
    const nextIndex = getNextStepIndex(currentStep, routeData.steps, userLocation)
    if (nextIndex !== null) setCurrentStep(nextIndex)
  }, [userLocation, routeData, currentStep])

  useEffect(() => {
    const t = setInterval(async () => {
      if (connStatusRef.current !== 'online') return
      const current   = routeDataRef.current
      const driverPos = userLocationRef.current
      if (!current || !driverPos) return

      try {
        const pendingStops = current.stops.filter((s) => s.status === 'pending')
        if (!pendingStops.length) return

        const destination   = pendingStops[pendingStops.length - 1]
        const intermediates = pendingStops.slice(0, -1)
        const route         = await computeRoute({
          origin: driverPos,
          destination:   { latitude: destination.latitude, longitude: destination.longitude },
          intermediates: intermediates.map((p) => ({ latitude: p.latitude, longitude: p.longitude })),
          routingPreference: 'TRAFFIC_AWARE',
        })

        const trafficMinutes = Math.round(route.durationSeconds / 60)
        setLiveEta(trafficMinutes)
        setRouteData((prev) =>
          prev
            ? { ...prev, total_duration: trafficMinutes, total_distance: parseFloat((route.distanceMeters / 1000).toFixed(1)) || prev.total_distance }
            : prev,
        )
      } catch (e) {
        console.error('Background ETA sync failed', e)
      }
    }, ETA_REFRESH_MS)
    return () => clearInterval(t)
  }, [])

  const handleMarkStop = useCallback((stopId: string) => {
    const stop = routeData?.stops.find((s) => s.destination_id === stopId)
    if (stop) setMarkingStop(stop)
  }, [routeData])

  const confirmMarkStop = useCallback(async (
    stopId:    string,
    newStatus: 'delivered' | 'failed',
  ) => {
    setMarkingBusy(true)
    try {
      await api.patch(`/booking/${bookingId}/destination/${stopId}`, { status: newStatus })
      setRouteData((prev) =>
        prev
          ? { ...prev, stops: prev.stops.map((s) => s.destination_id === stopId ? { ...s, status: newStatus } : s) }
          : prev,
      )
      setMarkingStop(null)
      if (userLocationRef.current && connStatusRef.current === 'online') {
        setTimeout(() => fetchRouteRef.current?.(true), 500)
      }
    } catch (err: any) {
      console.warn('[markStop] failed:', err)
      setMarkingStop(null)
    } finally {
      setMarkingBusy(false)
    }
  }, [bookingId])

  useEffect(() => { fetchRouteRef.current = fetchRoute }, [fetchRoute])

  useEffect(() => {
    if (!hasFetchedRef.current) { hasFetchedRef.current = true; fetchRoute(false) }
  }, [fetchRoute])

  useEffect(() => {
    const t = setInterval(async () => {
      const status = await getConnectionStatus()
      if (status === 'online') fetchRoute(true)
    }, ROUTE_REFRESH_MS)
    return () => clearInterval(t)
  }, [fetchRoute])

  useEffect(() => {
    if (!mapReady) return
    if (routePendingFit.current) { fitMapToRoute(routePendingFit.current); routePendingFit.current = null }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady, fitMapToRoute])

  useEffect(() => {
    Animated.spring(sheetAnim, {
      toValue: sheetOpen ? 1 : 0, useNativeDriver: false, tension: 80, friction: 12,
    }).start()
  }, [sheetOpen])

  const sheetHeight = sheetAnim.interpolate({ inputRange: [0, 1], outputRange: [180, SH * 0.62] })

  const nextStop           = useMemo(() => routeData?.stops.find((s) => s.status === 'pending'), [routeData])
  const completedCount     = useMemo(() => routeData?.stops.filter((s) => s.status === 'delivered').length ?? 0, [routeData])
  const currentInstruction = routeData?.steps[currentStep]
  const isOffline          = connStatus !== 'online'
  const showOfflineBadge   = isOffline || usingCache
  const displayEta         = liveEta ?? routeData?.total_duration ?? null

  const trafficGeoJSON = useMemo(
    () => routeData ? toTrafficFeatures(routeData.trafficSegments) : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [routeData?.trafficSegments],
  )

  const stopImages = useMemo(() => {
    if (!routeData) return {}
    return Object.fromEntries(
      routeData.stops.map((stop) => {
        const delivered = stop.status === 'delivered'
        const failed    = stop.status === 'failed'
        const isNext    = stop.destination_id === nextStop?.destination_id
        const bg        = delivered ? '#3af626' : failed ? '#ef4444' : isNext ? '#f59e0b' : '#333333'
        const label     = delivered ? '✓' : String(stop.optimized_sequence_order)
        return [`badge_${stop.destination_id}`, { uri: getBadgeUri(label, bg) }]
      })
    )
  }, [routeData, nextStop])

  const stopsGeoJSON = useMemo((): GeoJSON.FeatureCollection => ({
    type: 'FeatureCollection',
    features: (routeData?.stops ?? []).map((stop) => ({
      type:       'Feature' as const,
      id:         stop.destination_id,
      geometry:   { type: 'Point' as const, coordinates: toCoord(stop) },
      properties: { imageKey: `badge_${stop.destination_id}` },
    })),
  }), [routeData?.stops, nextStop])

  const cameraDefaultSettings = useMemo(
    () => userLocation
      ? { centerCoordinate: toCoord(userLocation), zoomLevel: 13, pitch: 0 }
      : { zoomLevel: 13 },
    [],
  )

  const recenter = useCallback(() => {
    setTrackingMode(true)
    if (userLocation) {
      cameraRef.current?.setCamera({
        centerCoordinate: toCoord(userLocation),
        heading, pitch: 45, zoomLevel: 17, animationDuration: 600,
      })
    }
  }, [userLocation, heading])

  const stopListData: Stop[] = useMemo(() => {
    if (!routeData) return []
    return [
      {
        destination_id: '__origin__', address: routeData.origin.address,
        latitude: routeData.origin.latitude, longitude: routeData.origin.longitude,
        optimized_sequence_order: 0, status: 'delivered',
      },
      ...routeData.stops,
    ]
  }, [routeData])

  const handleRegionIsChanging = useCallback(() => {
    if (trackingModeRef.current) { trackingModeRef.current = false; setTrackingMode(false) }
  }, [])

  if (loading) {
    return (
      // bg-surface-bg via className
      <View className="flex-1 items-center justify-center gap-3 bg-surface-bg">
        <ActivityIndicator size="large" color={C.cyan} />
        <Text style={{ fontSize: 14, color: C.dimWhite, marginTop: 8 }}>Loading route…</Text>
      </View>
    )
  }

  if (error) {
    return (
      <View
        className="flex-1 items-center justify-center bg-surface-bg px-8"
        style={{ paddingTop: insets.top }}
      >
        <AlertCircle size={40} color={C.red} />
        <Text style={{ fontSize: 14, textAlign: 'center', marginTop: 12, color: C.red }}>{error}</Text>
        <TouchableOpacity
          className="mt-4 py-2.5 px-7 rounded-xl bg-surface-raised border border-surface-border"
          onPress={() => { hasFetchedRef.current = false; fetchRoute(false) }}
        >
          <Text style={{ fontSize: 14, fontWeight: '600', color: C.cyan }}>Retry</Text>
        </TouchableOpacity>
      </View>
    )
  }

  return (
    <View className="flex-1 bg-surface-bg">
      <StatusBar barStyle="light-content" backgroundColor="transparent" translucent />

      <MarkStopModal
        stop={markingStop}
        onConfirm={confirmMarkStop}
        onClose={() => setMarkingStop(null)}
      />

      <MapLibreGL.MapView
        style={MAP_VIEW_STYLE}
        mapStyle={MAP_STYLE}
        logoEnabled={false}
        attributionEnabled={false}
        compassEnabled={false}
        onDidFinishLoadingMap={() => setMapReady(true)}
        onRegionIsChanging={handleRegionIsChanging}
      >
        <MapLibreGL.Camera ref={cameraRef} defaultSettings={cameraDefaultSettings} />

        {trafficGeoJSON && (
          <MapLibreGL.ShapeSource id="traffic-source" shape={trafficGeoJSON}>
            <MapLibreGL.LineLayer
              id="traffic-line"
              style={{ lineColor: ['get', 'color'] as any, lineWidth: 5, lineCap: 'round', lineJoin: 'round' }}
            />
          </MapLibreGL.ShapeSource>
        )}

        {routeData?.origin && (
          <MapLibreGL.PointAnnotation id="origin" coordinate={toCoord(routeData.origin)}>
            <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: C.cyanDim, borderWidth: 2, borderColor: C.cyan, alignItems: 'center', justifyContent: 'center' }}>
              <Truck size={14} color={C.cyan} />
            </View>
          </MapLibreGL.PointAnnotation>
        )}

        {userLocation && (
          <MapLibreGL.MarkerView id="user-location" coordinate={toCoord(userLocation)} anchor={{ x: 0.5, y: 0.5 }}>
            <View style={{ transform: [{ rotate: `${heading}deg` }] }}>
              <View style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: 'rgba(0,229,255,0.2)', borderWidth: 2, borderColor: C.cyan, alignItems: 'center', justifyContent: 'center' }}>
                <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: C.cyan }} />
              </View>
            </View>
          </MapLibreGL.MarkerView>
        )}

        {Object.keys(stopImages).length > 0 && (
          <MapLibreGL.Images images={stopImages} />
        )}

        {stopsGeoJSON.features.length > 0 && (
          <MapLibreGL.ShapeSource id="stops-source" shape={stopsGeoJSON}>
            <MapLibreGL.SymbolLayer
              id="stops-layer"
              style={{
                iconImage:           ['get', 'imageKey'] as any,
                iconSize:            1,
                iconAnchor:          'bottom',
                iconAllowOverlap:    true,
                iconIgnorePlacement: true,
              }}
            />
          </MapLibreGL.ShapeSource>
        )}
      </MapLibreGL.MapView>

      <AnimatePresence>
        {isRerouting && (
          <MotiView
            from={{ opacity: 0, translateY: -40 }}
            animate={{ opacity: 1, translateY: 0 }}
            exit={{ opacity: 0, translateY: -40 }}
            transition={{ type: 'spring', damping: 20, stiffness: 220 }}
            style={{
              position: 'absolute', left: 0, right: 0, zIndex: 30, top: insets.top,
              flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
              paddingVertical: 10, backgroundColor: C.rerouteBg,
              borderBottomWidth: 1, borderColor: C.rerouteBorder,
            }}
          >
            <RotateCw size={13} color={C.purple} />
            <Text style={{ fontSize: 12, fontWeight: '600', color: C.purple }}>Recalculating route…</Text>
          </MotiView>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {currentInstruction && !isRerouting && (
          <MotiView
            from={{ opacity: 0, translateY: -120 }}
            animate={{ opacity: 1, translateY: 0 }}
            exit={{ opacity: 0, translateY: -120 }}
            transition={{ type: 'spring', damping: 18, stiffness: 200 }}
            style={{
              position: 'absolute', top: insets.top + 10, left: 12, right: 12, zIndex: 20,
              borderRadius: 20, overflow: 'hidden',
              backgroundColor: 'rgba(13,42,46,0.92)',
              borderWidth: 1, borderColor: 'rgba(0,229,255,0.22)',
              shadowColor: '#000', shadowOffset: { width: 0, height: 6 },
              shadowOpacity: 0.45, shadowRadius: 16, elevation: 12,
              paddingTop: 14, paddingBottom: 16, paddingHorizontal: 14,
            }}
          >
            <AnimatePresence>
              {showOfflineBadge && (
                <MotiView
                  from={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 28 }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ type: 'timing', duration: 250 }}
                  style={{
                    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
                    marginBottom: 10, borderRadius: 8, overflow: 'hidden',
                    backgroundColor: C.offlineBg, borderWidth: 1, borderColor: C.offlineBorder,
                  }}
                >
                  <WifiOff size={11} color={C.orange} />
                  <Text style={{ fontSize: 11, fontWeight: '600', color: C.orange }}>
                    {isOffline
                      ? usingCache ? 'Offline — cached route' : 'No internet'
                      : 'Cached route · reconnecting…'}
                  </Text>
                </MotiView>
              )}
            </AnimatePresence>

            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <TouchableOpacity
                style={{ width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.08)', flexShrink: 0 }}
                onPress={() => router.back()}
              >
                <ArrowLeft size={18} color={C.white} />
              </TouchableOpacity>

              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 28, fontWeight: '900', letterSpacing: -0.5, lineHeight: 32, color: C.cyan }} numberOfLines={1}>
                  {currentInstruction.distance || '—'}
                </Text>
                <Text style={{ fontSize: 14, fontWeight: '600', lineHeight: 19, marginTop: 2, opacity: 0.9, color: C.white }} numberOfLines={2}>
                  {currentInstruction.instruction || 'Continue on current road'}
                </Text>
              </View>

              <View style={{ alignItems: 'center', gap: 6, flexShrink: 0 }}>
                <View style={{ width: 64, height: 64, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,229,255,0.1)', borderWidth: 1.5, borderColor: 'rgba(0,229,255,0.3)' }}>
                  <ManeuverIcon maneuver={currentInstruction.maneuver} />
                </View>

                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                  <TouchableOpacity
                    onPress={() => setCurrentStep((p) => Math.max(0, p - 1))}
                    disabled={currentStep === 0}
                    style={{ padding: 2, opacity: currentStep === 0 ? 0.25 : 1 }}
                  >
                    <ChevronUp size={13} color={C.cyan} />
                  </TouchableOpacity>
                  <Text style={{ fontSize: 10, fontWeight: '600', textAlign: 'center', minWidth: 28, color: C.dimWhite }}>
                    {currentStep + 1}/{routeData?.steps.length ?? 1}
                  </Text>
                  <TouchableOpacity
                    onPress={() => setCurrentStep((p) => Math.min((routeData?.steps.length ?? 1) - 1, p + 1))}
                    disabled={currentStep === (routeData?.steps.length ?? 1) - 1}
                    style={{ padding: 2, opacity: currentStep === (routeData?.steps.length ?? 1) - 1 ? 0.25 : 1 }}
                  >
                    <ChevronDown size={13} color={C.cyan} />
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          </MotiView>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showOfflineBadge && !currentInstruction && !isRerouting && (
          <MotiView
            from={{ opacity: 0, translateY: -30 }}
            animate={{ opacity: 1, translateY: 0 }}
            exit={{ opacity: 0, translateY: -30 }}
            transition={{ type: 'spring', damping: 20, stiffness: 220 }}
            style={{
              position: 'absolute', left: 0, right: 0, zIndex: 20, top: insets.top,
              flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
              paddingVertical: 8, backgroundColor: C.offlineBg,
              borderBottomWidth: 1, borderColor: C.offlineBorder,
            }}
          >
            <WifiOff size={13} color={C.orange} />
            <Text style={{ fontSize: 12, fontWeight: '600', color: C.orange }}>
              {isOffline
                ? usingCache ? 'Offline — showing cached route' : 'No internet connection'
                : 'Cached route · reconnecting…'}
            </Text>
          </MotiView>
        )}
      </AnimatePresence>

      {!trackingMode && (
        <MotiView
          from={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          style={{ position: 'absolute', right: 16, zIndex: 20, bottom: sheetOpen ? SH * 0.62 + 16 : 196 }}
        >
          <TouchableOpacity
            onPress={recenter}
            style={{ width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: C.overlay, borderWidth: 1, borderColor: 'rgba(0,229,255,0.3)' }}
          >
            <Navigation2 size={18} color={C.cyan} />
          </TouchableOpacity>
        </MotiView>
      )}

      {nextStop && !sheetOpen && (
        <MotiView
          from={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          style={{ position: 'absolute', left: 16, zIndex: 20, bottom: 196 }}
        >
          <TouchableOpacity
            onPress={() => handleMarkStop(nextStop.destination_id)}
            style={{
              flexDirection: 'row', alignItems: 'center', gap: 6,
              paddingHorizontal: 14, paddingVertical: 10, borderRadius: 20,
              backgroundColor: C.overlay, borderWidth: 1, borderColor: 'rgba(58,246,38,0.35)',
            }}
          >
            <PackageCheck size={15} color={C.green} />
            <Text style={{ fontSize: 12, fontWeight: '700', color: C.green }}>Mark Stop</Text>
          </TouchableOpacity>
        </MotiView>
      )}

      <Animated.View
        style={{
          position: 'absolute', bottom: 0, left: 0, right: 0,
          height: sheetHeight,
          backgroundColor: C.surface,
          borderTopLeftRadius: 24, borderTopRightRadius: 24,
          borderTopWidth: 1, borderColor: C.border, overflow: 'hidden',
        }}
      >
        <TouchableOpacity
          style={{ paddingHorizontal: 16, paddingTop: 10, paddingBottom: 8 }}
          onPress={() => setSheetOpen((o) => !o)}
          activeOpacity={0.8}
        >
          <View style={{ width: 40, height: 4, borderRadius: 2, alignSelf: 'center', marginBottom: 12, backgroundColor: C.border }} />

          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 10 }}>
            {[
              { icon: <Clock size={13} color={C.cyan} />,         value: displayEta != null ? fmtDuration(displayEta) : '—', label: 'ETA',   valueColor: C.white },
              { icon: <RouteIcon size={13} color={C.cyan} />,     value: routeData ? fmtDistance(routeData.total_distance) : '—', label: 'Total', valueColor: C.white },
              { icon: <CheckCircle2 size={13} color={C.green} />, value: `${completedCount}/${routeData?.stops.length ?? 0}`,    label: 'Done',  valueColor: C.green },
            ].map(({ icon, value, label, valueColor }) => (
              <View key={label} style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 10, paddingVertical: 8, paddingHorizontal: 10, backgroundColor: C.surfaceHi, borderWidth: 1, borderColor: C.border }}>
                {icon}
                <Text style={{ fontSize: 13, fontWeight: '700', flex: 1, color: valueColor }}>{value}</Text>
                <Text style={{ fontSize: 10, color: C.dimmer }}>{label}</Text>
              </View>
            ))}

            <View style={{ paddingLeft: 4 }}>
              {sheetOpen
                ? <ChevronDown size={16} color={C.dimWhite} />
                : <ChevronUp   size={16} color={C.dimWhite} />}
            </View>
          </View>

          {/* Progress bar */}
          {routeData && (
            <View style={{ height: 3, borderRadius: 2, overflow: 'hidden', backgroundColor: C.border }}>
              <View style={{ height: 3, borderRadius: 2, width: `${(completedCount / routeData.stops.length) * 100}%`, backgroundColor: C.cyan }} />
            </View>
          )}
        </TouchableOpacity>

        {nextStop && (
          <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10, borderTopWidth: 1, borderColor: C.border, gap: 10 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <MapPin size={14} color={C.orange} />
              <Text style={{ fontSize: 12, fontWeight: '700', color: C.orange }}>Next stop</Text>
            </View>
            <Text style={{ fontSize: 13, flex: 1, color: C.white }} numberOfLines={1}>{nextStop.address}</Text>
            <TouchableOpacity
              onPress={() => handleMarkStop(nextStop.destination_id)}
              style={{ paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, backgroundColor: 'rgba(58,246,38,0.1)', borderWidth: 1, borderColor: C.green }}
            >
              <Text style={{ fontSize: 11, fontWeight: '700', color: C.green }}>Mark</Text>
            </TouchableOpacity>
          </View>
        )}

        {sheetOpen && routeData && (
          <FlatList
            data={stopListData}
            keyExtractor={(item) => item.destination_id}
            contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 32 }}
            showsVerticalScrollIndicator={false}
            renderItem={({ item, index }) => (
              <StopRow
                stop={item}
                isOrigin={item.destination_id === '__origin__'}
                isLast={index === stopListData.length - 1}
                isCurrent={item.destination_id === nextStop?.destination_id}
                onMark={handleMarkStop}
              />
            )}
          />
        )}
      </Animated.View>
    </View>
  )
}