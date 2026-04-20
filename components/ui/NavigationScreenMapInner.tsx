/**
 * Mapbox implementation for driver navigation (loaded dynamically from
 * NavigationScreen.tsx so @rnmapbox/maps is not evaluated during route discovery).
 */

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
  StatusBar,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'
import MapboxGL from '@rnmapbox/maps'
import * as Location from 'expo-location'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { MotiView, AnimatePresence } from 'moti'
import { useRouter } from 'expo-router'
import AsyncStorage from '@react-native-async-storage/async-storage'
import NetInfo, { NetInfoState } from '@react-native-community/netinfo'
import {
  ArrowLeft,
  Navigation2,
  MapPin,
  ChevronDown,
  ChevronUp,
  Clock,
  Route,
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
} from 'lucide-react-native'

import api from '../../lib/api/auth.api'

// ─── Mapbox init ──────────────────────────────────────────────────────────────
// Called once at module level — safe to call multiple times (idempotent)
MapboxGL.setAccessToken(process.env.EXPO_PUBLIC_MAPBOX_TOKEN ?? '')

const { height: SH } = Dimensions.get('window')

// ─── Theme ────────────────────────────────────────────────────────────────────

const C = {
  bg:           '#0a0a0a',
  surface:      '#111111',
  surfaceHi:    '#1a1a1a',
  border:       '#242424',
  cyan:         '#00e5ff',
  cyanDim:      'rgba(0,229,255,0.12)',
  white:        '#ffffff',
  dimWhite:     'rgba(255,255,255,0.55)',
  dimmer:       'rgba(255,255,255,0.25)',
  green:        '#3af626',
  orange:       '#f59e0b',
  red:          '#ef4444',
  overlay:      'rgba(0,0,0,0.85)',
  bannerBg:     '#0d2a2e',
  bannerBorder: 'rgba(0,229,255,0.25)',
  offlineBg:    '#1a1200',
  offlineBorder:'rgba(245,158,11,0.35)',
}

// Mapbox dark style — swap this for your own Mapbox Studio URL if you have one
const MAPBOX_STYLE = MapboxGL.StyleURL.Dark

// ─── Types ────────────────────────────────────────────────────────────────────

interface LatLng {
  latitude:  number
  longitude: number
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

interface RouteStep {
  instruction:   string
  distance:      string
  duration:      string
  maneuver?:     string
  startLocation: LatLng
}

interface TrafficSegment {
  coords: LatLng[]
  speed:  'fast' | 'normal' | 'slow' | 'jam'
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

// ─── Cache helpers ────────────────────────────────────────────────────────────

const routeCacheKey = (id: string) => `nav_route_cache_${id}`

async function saveRouteCache(bookingId: string, data: BookingRoute): Promise<void> {
  try {
    await AsyncStorage.setItem(routeCacheKey(bookingId), JSON.stringify(data))
  } catch { /* non-critical */ }
}

async function loadRouteCache(bookingId: string): Promise<BookingRoute | null> {
  try {
    const raw = await AsyncStorage.getItem(routeCacheKey(bookingId))
    return raw ? (JSON.parse(raw) as BookingRoute) : null
  } catch { return null }
}

// ─── Offline tile pack helpers ────────────────────────────────────────────────

function getBounds(points: LatLng[]): [[number, number], [number, number]] {
  const lngs = points.map((p) => p.longitude)
  const lats  = points.map((p) => p.latitude)
  // Mapbox expects [ne, sw] as [lng, lat] pairs
  return [
    [Math.max(...lngs), Math.max(...lats)], // NE
    [Math.min(...lngs), Math.min(...lats)], // SW
  ]
}

async function ensureOfflinePack(bookingId: string, points: LatLng[]): Promise<void> {
  try {
    const name  = `trip_${bookingId}`
    const packs = await MapboxGL.offlineManager.getPacks()
    if (packs.some((p) => p.name === name)) return // already downloaded

    const [ne, sw] = getBounds(points)
    await MapboxGL.offlineManager.createPack(
      {
        name,
        styleURL: MAPBOX_STYLE,
        minZoom:  10,
        maxZoom:  16,
        bounds:   [ne, sw],
      },
      (_region, status) => {
        // optional: track progress — status.percentage
        if (__DEV__) console.log('[offline] tile pack progress:', status?.percentage)
      },
      (_region, err) => {
        console.warn('[offline] tile pack error:', err)
      },
    )
  } catch (err) {
    // Non-critical — map will fall back to cached tiles if any exist
    console.warn('[offline] ensureOfflinePack failed:', err)
  }
}

// ─── GeoJSON converters ───────────────────────────────────────────────────────
// Mapbox uses GeoJSON [longitude, latitude] — opposite of Google/expo-location

type Coord = [number, number]

function toCoord(p: LatLng): Coord {
  return [p.longitude, p.latitude]
}

function toLineString(points: LatLng[]): GeoJSON.Feature<GeoJSON.LineString> {
  return {
    type:       'Feature',
    geometry:   { type: 'LineString', coordinates: points.map(toCoord) },
    properties: {},
  }
}

/** Single FeatureCollection with a `color` property per segment — one draw call */
function toTrafficFeatures(
  segments: TrafficSegment[],
): GeoJSON.FeatureCollection<GeoJSON.LineString> {
  return {
    type:     'FeatureCollection',
    features: segments.map((seg, i) => ({
      type:       'Feature',
      id:         String(i),
      geometry:   { type: 'LineString', coordinates: seg.coords.map(toCoord) },
      properties: { color: trafficColor(seg.speed) },
    })),
  }
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function decodePolyline(encoded: string): LatLng[] {
  const points: LatLng[] = []
  let index = 0, lat = 0, lng = 0
  while (index < encoded.length) {
    let shift = 0, result = 0, byte: number
    do { byte = encoded.charCodeAt(index++) - 63; result |= (byte & 0x1f) << shift; shift += 5 }
    while (byte >= 0x20)
    lat += result & 1 ? ~(result >> 1) : result >> 1
    shift = 0; result = 0
    do { byte = encoded.charCodeAt(index++) - 63; result |= (byte & 0x1f) << shift; shift += 5 }
    while (byte >= 0x20)
    lng += result & 1 ? ~(result >> 1) : result >> 1
    points.push({ latitude: lat / 1e5, longitude: lng / 1e5 })
  }
  return points
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

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim()
}

function speedCategory(speed: number): TrafficSegment['speed'] {
  if (speed <= 0) return 'fast'
  if (speed === 1) return 'normal'
  if (speed === 2) return 'slow'
  return 'jam'
}

function trafficColor(speed: TrafficSegment['speed']): string {
  switch (speed) {
    case 'fast':   return '#00e5ff'
    case 'normal': return '#00e5ff'
    case 'slow':   return '#f59e0b'
    case 'jam':    return '#ef4444'
  }
}

function buildTrafficSegments(
  points: LatLng[],
  intervals: Array<{ startPolylinePointIndex?: number; endPolylinePointIndex?: number; speed?: number }>,
): TrafficSegment[] {
  if (!intervals?.length) return [{ coords: points, speed: 'fast' }]
  return intervals
    .map((iv) => {
      const start  = iv.startPolylinePointIndex ?? 0
      const end    = iv.endPolylinePointIndex   ?? points.length - 1
      const coords = points.slice(start, end + 2)
      return coords.length >= 2 ? { coords, speed: speedCategory(iv.speed ?? 0) } : null
    })
    .filter(Boolean) as TrafficSegment[]
}

function haversineDistance(a: LatLng, b: LatLng): number {
  const R      = 6_371_000
  const toRad  = (d: number) => (d * Math.PI) / 180
  const dLat   = toRad(b.latitude  - a.latitude)
  const dLng   = toRad(b.longitude - a.longitude)
  const sinLat = Math.sin(dLat / 2)
  const sinLng = Math.sin(dLng / 2)
  return 2 * R * Math.asin(Math.sqrt(
    sinLat * sinLat + Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * sinLng * sinLng,
  ))
}

const STEP_ADVANCE_THRESHOLD_M = 40

// ─── ManeuverIcon ─────────────────────────────────────────────────────────────

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

// ─── StopRow ──────────────────────────────────────────────────────────────────

function StopRow({
  stop, isOrigin, isLast, isCurrent,
}: {
  stop: Stop; isOrigin?: boolean; isLast?: boolean; isCurrent?: boolean
}) {
  const delivered = stop.status === 'delivered'
  const failed    = stop.status === 'failed'
  const dotColor  = isOrigin ? C.cyan : delivered ? C.green : failed ? C.red : isCurrent ? C.orange : C.dimmer
  const dotBg     = delivered ? C.green : failed ? C.red : 'transparent'

  return (
    <View className="flex-row gap-3 min-h-[56px]">
      <View className="items-center w-8 shrink-0">
        <View
          className="w-7 h-7 rounded-full border-2 items-center justify-center shrink-0"
          style={{ borderColor: dotColor, backgroundColor: dotBg }}
        >
          {delivered  && <CheckCircle2 size={10} color="#000" />}
          {failed     && <AlertCircle  size={10} color="#fff" />}
          {!delivered && !failed && isOrigin  && <Navigation2 size={10} color={C.cyan} />}
          {!delivered && !failed && !isOrigin && (
            <Text className="text-[11px] font-black" style={{ color: dotColor }}>
              {stop.optimized_sequence_order}
            </Text>
          )}
        </View>
        {!isLast && (
          <View
            className="flex-1 w-0.5 border-l border-dashed my-0.5 min-h-5"
            style={{ borderColor: delivered ? C.green : C.border }}
          />
        )}
      </View>

      <View className="flex-1 pt-1 pb-3">
        <Text
          className="text-sm font-semibold leading-5"
          style={{ color: isCurrent ? C.orange : C.white }}
          numberOfLines={2}
        >
          {stop.address}
        </Text>
        {isOrigin && (
          <Text className="text-[11px] mt-0.5" style={{ color: C.dimWhite }}>
            Origin · Pickup
          </Text>
        )}
        {!isOrigin && (
          <Text
            className="text-[11px] mt-0.5"
            style={{ color: delivered ? C.green : failed ? C.red : isCurrent ? C.orange : C.dimWhite }}
          >
            {delivered ? 'Delivered' : failed ? 'Failed' : isCurrent ? 'Next stop' : 'Pending'}
          </Text>
        )}
      </View>
    </View>
  )
}

// ─── NavigationScreen ─────────────────────────────────────────────────────────

interface NavigationScreenProps {
  bookingId: string
}

const ROUTE_REFRESH_MS = 60_000

export default function NavigationScreenMapInner({ bookingId }: NavigationScreenProps) {
  const insets   = useSafeAreaInsets()
  const router   = useRouter()
  const cameraRef = useRef<MapboxGL.Camera>(null)

  const [routeData,    setRouteData]    = useState<BookingRoute | null>(null)
  const [loading,      setLoading]      = useState(true)
  const [error,        setError]        = useState<string | null>(null)
  const [userLocation, setUserLocation] = useState<LatLng | null>(null)
  const [heading,      setHeading]      = useState<number>(0)
  const [sheetOpen,    setSheetOpen]    = useState(false)
  const [currentStep,  setCurrentStep]  = useState(0)
  const [trackingMode, setTrackingMode] = useState(true)
  const [mapReady,     setMapReady]     = useState(false)
  const [isOffline,    setIsOffline]    = useState(false)
  const [usingCache,   setUsingCache]   = useState(false)

  const trackingModeRef = useRef(trackingMode)
  const userLocationRef = useRef<LatLng | null>(null)
  const hasFetchedRef   = useRef(false)
  const isOfflineRef    = useRef(isOffline)
  const fetchRouteRef   = useRef<((isRefresh?: boolean) => Promise<void>) | null>(null)

  useEffect(() => { trackingModeRef.current = trackingMode }, [trackingMode])
  useEffect(() => { isOfflineRef.current    = isOffline    }, [isOffline])

  const sheetAnim       = useRef(new Animated.Value(0)).current
  const routePendingFit = useRef<LatLng[] | null>(null)

  // ── NetInfo ────────────────────────────────────────────────────────────────

  useEffect(() => {
    NetInfo.fetch().then((s: NetInfoState) => setIsOffline(!s.isConnected))

    const unsub = NetInfo.addEventListener((s: NetInfoState) => {
      const offline = !s.isConnected
      setIsOffline(offline)
      isOfflineRef.current = offline
      if (!offline && fetchRouteRef.current) fetchRouteRef.current(true)
    })
    return () => unsub()
  }, [])

  // ── GPS ────────────────────────────────────────────────────────────────────

  useEffect(() => {
    let sub: Location.LocationSubscription | null = null
    ;(async () => {
      const { status } = await Location.requestForegroundPermissionsAsync()
      if (status !== 'granted') {
        setError('Location permission denied. Please enable it in settings.')
        setLoading(false)
        return
      }

      // Seed immediately from last-known — no cold-start wait
      const last = await Location.getLastKnownPositionAsync()
      if (last) {
        const pos = { latitude: last.coords.latitude, longitude: last.coords.longitude }
        setUserLocation(pos)
        userLocationRef.current = pos
        setHeading(last.coords.heading ?? 0)
      }

      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced })
      const pos = { latitude: loc.coords.latitude, longitude: loc.coords.longitude }
      setUserLocation(pos)
      userLocationRef.current = pos
      setHeading(loc.coords.heading ?? 0)

      sub = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.BestForNavigation, timeInterval: 2000, distanceInterval: 5 },
        (loc) => {
          const pos = { latitude: loc.coords.latitude, longitude: loc.coords.longitude }
          setUserLocation(pos)
          userLocationRef.current = pos
          const hdg = loc.coords.heading ?? 0
          setHeading(hdg)
          if (trackingModeRef.current) {
            cameraRef.current?.setCamera({
              centerCoordinate: toCoord(pos),
              heading:          hdg,
              pitch:            45,
              zoomLevel:        17,
              animationDuration: 500,
            })
          }
        },
      )
    })()
    return () => { sub?.remove() }
  }, [])

  // ── Auto-advance steps ─────────────────────────────────────────────────────

  useEffect(() => {
    if (!userLocation || !routeData?.steps.length) return
    const nextIndex = currentStep + 1
    if (nextIndex >= routeData.steps.length) return
    const next = routeData.steps[nextIndex]
    if (!next?.startLocation) return
    if (haversineDistance(userLocation, next.startLocation) <= STEP_ADVANCE_THRESHOLD_M) {
      setCurrentStep(nextIndex)
    }
  }, [userLocation, routeData, currentStep])

  // ── Fit helper ─────────────────────────────────────────────────────────────

  const fitMapToRoute = useCallback((polyline: LatLng[]) => {
    if (!polyline.length) return
    const lngs = polyline.map((p) => p.longitude)
    const lats  = polyline.map((p) => p.latitude)
    cameraRef.current?.fitBounds(
      [Math.max(...lngs), Math.max(...lats)], // NE [lng, lat]
      [Math.min(...lngs), Math.min(...lats)], // SW [lng, lat]
      [220, 60, 320, 60],                     // padding [top, right, bottom, left]
      800,
    )
  }, [])

  // ── fetchRoute ─────────────────────────────────────────────────────────────

  const fetchRoute = useCallback(async (isRefresh = false) => {
    if (isOfflineRef.current && isRefresh) return

    if (!isRefresh) { setLoading(true); setError(null) }

    // Offline initial load — serve cache
    if (isOfflineRef.current && !isRefresh) {
      const cached = await loadRouteCache(bookingId)
      if (cached) {
        setRouteData(cached)
        setUsingCache(true)
        setLoading(false)
        if (mapReady) fitMapToRoute(cached.polyline)
        else routePendingFit.current = cached.polyline
        return
      }
      setError('No internet connection and no cached route available.')
      setLoading(false)
      return
    }

    // Wait for GPS (up to 10s)
    let driverPos = userLocationRef.current
    if (!driverPos) {
      for (let i = 0; i < 20; i++) {
        await new Promise((r) => setTimeout(r, 500))
        driverPos = userLocationRef.current
        if (driverPos) break
      }
    }

    if (!driverPos) {
      const cached = await loadRouteCache(bookingId)
      if (cached) {
        setRouteData(cached)
        setUsingCache(true)
        setLoading(false)
        if (mapReady) fitMapToRoute(cached.polyline)
        else routePendingFit.current = cached.polyline
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

      const isPickedUp   = ['picked_up', 'in_transit', 'delivered'].includes(booking.status)
      const pendingStops = allStops.filter((s) => s.status === 'pending')

      if (pendingStops.length === 0 && isPickedUp) {
        setRouteData((prev) => prev ? { ...prev, stops: allStops } : null)
        if (!isRefresh) setLoading(false)
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
        routeModifiers:    { avoidFerries: true },
        units:             'METRIC',
        extraComputations: ['TRAFFIC_ON_POLYLINE'],
      })

      const route    = directionsRes.data.data.routes[0]
      const polyline = decodePolyline(route.polyline.encodedPolyline)
      const totalMins = Math.round(parseInt(route.duration ?? '0') / 60)

      const trafficSegments = buildTrafficSegments(
        polyline,
        route.travelAdvisory?.speedReadingIntervals ?? [],
      )

      const steps: RouteStep[] = (route.legs ?? []).flatMap((leg: any) =>
        (leg.steps ?? []).map((step: any): RouteStep => ({
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
        origin: pickup, stops: allStops,
        total_duration: totalMins,
        total_distance: parseFloat((route.distanceMeters / 1000).toFixed(1)) || 0,
        polyline, trafficSegments, steps,
      }

      setRouteData(newRoute)
      setUsingCache(false)
      setCurrentStep(0)
      setTrackingMode(false)

      // Persist to AsyncStorage cache + download offline tiles (non-blocking)
      saveRouteCache(bookingId, newRoute)
      ensureOfflinePack(bookingId, [
        pickup,
        ...allStops.map((s) => ({ latitude: s.latitude, longitude: s.longitude })),
        ...polyline,
      ])

      if (mapReady) fitMapToRoute(polyline)
      else routePendingFit.current = polyline

    } catch (err: any) {
      if (!isRefresh) {
        const cached = await loadRouteCache(bookingId)
        if (cached) {
          setRouteData(cached)
          setUsingCache(true)
          setLoading(false)
          if (mapReady) fitMapToRoute(cached.polyline)
          else routePendingFit.current = cached.polyline
          return
        }
        setError(err?.response?.data?.message ?? err?.message ?? 'Failed to load route')
      }
    } finally {
      if (!isRefresh) setLoading(false)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookingId, fitMapToRoute])

  useEffect(() => { fetchRouteRef.current = fetchRoute }, [fetchRoute])

  useEffect(() => {
    if (!hasFetchedRef.current) {
      hasFetchedRef.current = true
      fetchRoute(false)
    }
  }, [fetchRoute])

  useEffect(() => {
    const t = setInterval(async () => {
      const state = await NetInfo.fetch()
      if (state.isConnected) fetchRoute(true)
    }, ROUTE_REFRESH_MS)
    return () => clearInterval(t)
  }, [fetchRoute])

  useEffect(() => {
    if (mapReady && routeData?.polyline.length) fitMapToRoute(routeData.polyline)
  }, [mapReady, routeData, fitMapToRoute])

  const handleMapReady = useCallback(() => {
    setMapReady(true)
    if (routePendingFit.current) {
      fitMapToRoute(routePendingFit.current)
      routePendingFit.current = null
    }
  }, [fitMapToRoute])

  // ── Sheet animation ────────────────────────────────────────────────────────

  useEffect(() => {
    Animated.spring(sheetAnim, {
      toValue: sheetOpen ? 1 : 0, useNativeDriver: false, tension: 80, friction: 12,
    }).start()
  }, [sheetOpen])

  const sheetHeight = sheetAnim.interpolate({ inputRange: [0, 1], outputRange: [180, SH * 0.62] })

  // ── Derived ────────────────────────────────────────────────────────────────

  const nextStop           = useMemo(() => routeData?.stops.find((s) => s.status === 'pending'), [routeData])
  const completedCount     = useMemo(() => routeData?.stops.filter((s) => s.status === 'delivered').length ?? 0, [routeData])
  const currentInstruction = routeData?.steps[currentStep]
  const showOfflineBadge   = isOffline || usingCache

  const trafficGeoJSON = useMemo(
    () => routeData ? toTrafficFeatures(routeData.trafficSegments) : null,
    [routeData],
  )

  const recenter = useCallback(() => {
    setTrackingMode(true)
    if (userLocation) {
      cameraRef.current?.setCamera({
        centerCoordinate: toCoord(userLocation),
        heading,
        pitch:            45,
        zoomLevel:        17,
        animationDuration: 600,
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

  // ── Render ─────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <View className="flex-1 items-center justify-center gap-3" style={{ backgroundColor: C.bg }}>
        <ActivityIndicator size="large" color={C.cyan} />
        <Text className="text-sm mt-2" style={{ color: C.dimWhite }}>Loading route…</Text>
      </View>
    )
  }

  if (error) {
    return (
      <View
        className="flex-1 items-center justify-center gap-3 px-8"
        style={{ backgroundColor: C.bg, paddingTop: insets.top }}
      >
        <AlertCircle size={40} color={C.red} />
        <Text className="text-sm text-center mt-3" style={{ color: C.red }}>{error}</Text>
        <TouchableOpacity
          className="mt-4 py-2.5 px-7 rounded-xl border"
          style={{ backgroundColor: C.surfaceHi, borderColor: C.border }}
          onPress={() => { hasFetchedRef.current = false; fetchRoute(false) }}
        >
          <Text className="text-sm font-semibold" style={{ color: C.cyan }}>Retry</Text>
        </TouchableOpacity>
      </View>
    )
  }

  return (
    <View className="flex-1" style={{ backgroundColor: C.bg }}>
      <StatusBar barStyle="light-content" backgroundColor="transparent" translucent />

      {/* ── Mapbox map ── */}
      <MapboxGL.MapView
        style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
        styleURL={MAPBOX_STYLE}
        logoEnabled={false}
        attributionEnabled={false}
        compassEnabled={false}
        scaleBarEnabled={false}
        onDidFinishLoadingMap={handleMapReady}
        // Disable tracking mode when user pans
        onTouchStart={() => setTrackingMode(false)}
      >
        {/* Camera — controlled via ref */}
        <MapboxGL.Camera
          ref={cameraRef}
          defaultSettings={
            userLocation
              ? {
                  centerCoordinate: toCoord(userLocation),
                  zoomLevel:        13,
                  pitch:            0,
                }
              : { zoomLevel: 13 }
          }
        />

        {/* ── Traffic-coloured route polyline ── */}
        {trafficGeoJSON && (
          <MapboxGL.ShapeSource id="traffic-source" shape={trafficGeoJSON}>
            <MapboxGL.LineLayer
              id="traffic-line"
              style={{
                lineColor:  ['get', 'color'] as any,
                lineWidth:  5,
                lineCap:    'round',
                lineJoin:   'round',
              }}
            />
          </MapboxGL.ShapeSource>
        )}

        {/* ── Origin marker ── */}
        {routeData?.origin && (
          <MapboxGL.MarkerView
            id="origin"
            coordinate={toCoord(routeData.origin)}
          >
            <View
              style={{
                width: 36, height: 36, borderRadius: 18,
                backgroundColor: C.cyanDim,
                borderWidth: 2, borderColor: C.cyan,
                alignItems: 'center', justifyContent: 'center',
                shadowColor: C.cyan, shadowOffset: { width: 0, height: 0 },
                shadowOpacity: 0.6, shadowRadius: 8, elevation: 6,
              }}
            >
              <Truck size={14} color={C.cyan} />
            </View>
          </MapboxGL.MarkerView>
        )}

        {/* ── Stop markers ── */}
        {routeData?.stops.map((stop) => {
          const delivered = stop.status === 'delivered'
          const failed    = stop.status === 'failed'
          const isNext    = stop.destination_id === nextStop?.destination_id
          const bg        = delivered ? C.green : failed ? C.red : isNext ? C.orange : C.surfaceHi
          return (
            <MapboxGL.MarkerView
              key={stop.destination_id}
              id={stop.destination_id}
              coordinate={toCoord(stop)}
              anchor={{ x: 0.5, y: 1 }}
            >
              <View style={{ alignItems: 'center' }}>
                <View
                  style={{
                    width: 28, height: 28, borderRadius: 14,
                    backgroundColor: bg, borderWidth: 2, borderColor: bg,
                    alignItems: 'center', justifyContent: 'center',
                    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
                    shadowOpacity: 0.4, shadowRadius: 4, elevation: 4,
                  }}
                >
                  <Text style={{ color: C.white, fontSize: 11, fontWeight: '900' }}>
                    {stop.optimized_sequence_order}
                  </Text>
                </View>
                {/* Callout tip */}
                <View
                  style={{
                    width: 0, height: 0,
                    borderLeftWidth: 5, borderRightWidth: 5, borderTopWidth: 7,
                    borderLeftColor: 'transparent', borderRightColor: 'transparent',
                    borderTopColor: bg, marginTop: -1,
                  }}
                />
              </View>
            </MapboxGL.MarkerView>
          )
        })}

        {/* ── User location dot with heading rotation ── */}
        {userLocation && (
          <MapboxGL.MarkerView
            id="user-location"
            coordinate={toCoord(userLocation)}
            anchor={{ x: 0.5, y: 0.5 }}
          >
            {/* Outer wrapper rotated to heading */}
            <View style={{ transform: [{ rotate: `${heading}deg` }] }}>
              <View
                style={{
                  width: 24, height: 24, borderRadius: 12,
                  backgroundColor: 'rgba(0,229,255,0.2)',
                  borderWidth: 2, borderColor: C.cyan,
                  alignItems: 'center', justifyContent: 'center',
                  shadowColor: C.cyan, shadowOffset: { width: 0, height: 0 },
                  shadowOpacity: 0.8, shadowRadius: 8, elevation: 8,
                }}
              >
                <View
                  style={{
                    width: 10, height: 10, borderRadius: 5,
                    backgroundColor: C.cyan,
                  }}
                />
              </View>
            </View>
          </MapboxGL.MarkerView>
        )}
      </MapboxGL.MapView>

{/* ── Floating turn-by-turn card ── */}
<AnimatePresence>
  {currentInstruction && (
    <MotiView
      from={{ opacity: 0, translateY: -80, scale: 0.95 }}
      animate={{ opacity: 1, translateY: 0, scale: 1 }}
      exit={{ opacity: 0, translateY: -80, scale: 0.95 }}
      transition={{ type: 'spring', damping: 20, stiffness: 220 }}
      style={{
        position:   'absolute',
        top:        insets.top + 10,
        left:       12,
        right:      12,
        zIndex:     20,
      }}
    >
      {/* Offline strip — above card */}
      <AnimatePresence>
        {showOfflineBadge && (
          <MotiView
            from={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 28 }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ type: 'timing', duration: 220 }}
            style={{
              flexDirection:   'row',
              alignItems:      'center',
              justifyContent:  'center',
              gap:             5,
              marginBottom:    6,
              borderRadius:    10,
              overflow:        'hidden',
              backgroundColor: C.offlineBg,
              borderWidth:     1,
              borderColor:     C.offlineBorder,
            }}
          >
            <WifiOff size={10} color={C.orange} />
            <Text style={{ fontSize: 11, fontWeight: '600', color: C.orange }}>
              {isOffline
                ? usingCache ? 'Offline — cached route' : 'No internet'
                : 'Cached route · reconnecting…'}
            </Text>
          </MotiView>
        )}
      </AnimatePresence>

      {/* Card */}
      <View
        style={{
          flexDirection:   'row',
          alignItems:      'center',
          gap:             12,
          paddingVertical: 14,
          paddingLeft:     14,
          paddingRight:    12,
          borderRadius:    20,
          backgroundColor: C.bannerBg,
          borderWidth:     1,
          borderColor:     C.bannerBorder,
          shadowColor:     '#000',
          shadowOffset:    { width: 0, height: 8 },
          shadowOpacity:   0.55,
          shadowRadius:    16,
          elevation:       18,
        }}
      >
        {/* Back button */}
        <TouchableOpacity
          onPress={() => router.back()}
          style={{
            width:           36,
            height:          36,
            borderRadius:    18,
            alignItems:      'center',
            justifyContent:  'center',
            backgroundColor: 'rgba(255,255,255,0.07)',
            flexShrink:      0,
          }}
        >
          <ArrowLeft size={17} color={C.white} />
        </TouchableOpacity>

        {/* Distance + instruction */}
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text
            style={{
              fontSize:      28,
              fontWeight:    '900',
              letterSpacing: -0.5,
              lineHeight:    30,
              color:         C.cyan,
            }}
            numberOfLines={1}
          >
            {currentInstruction.distance || '—'}
          </Text>
          <Text
            style={{
              fontSize:    14,
              fontWeight:  '600',
              lineHeight:  19,
              marginTop:   2,
              color:       C.white,
              opacity:     0.88,
            }}
            numberOfLines={2}
          >
            {currentInstruction.instruction || 'Continue on current road'}
          </Text>
        </View>

        {/* Maneuver box + step stepper */}
        <View style={{ alignItems: 'center', gap: 6, flexShrink: 0 }}>
          <View
            style={{
              width:           62,
              height:          62,
              borderRadius:    16,
              alignItems:      'center',
              justifyContent:  'center',
              backgroundColor: 'rgba(0,229,255,0.10)',
              borderWidth:     1.5,
              borderColor:     'rgba(0,229,255,0.30)',
            }}
          >
            <ManeuverIcon maneuver={currentInstruction.maneuver} />
          </View>

          {/* Step stepper */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
            <TouchableOpacity
              onPress={() => setCurrentStep((p) => Math.max(0, p - 1))}
              disabled={currentStep === 0}
              style={{ padding: 2, opacity: currentStep === 0 ? 0.2 : 1 }}
            >
              <ChevronUp size={12} color={C.cyan} />
            </TouchableOpacity>
            <Text
              style={{
                fontSize:   10,
                fontWeight: '600',
                color:      C.dimWhite,
                minWidth:   28,
                textAlign:  'center',
              }}
            >
              {currentStep + 1}/{routeData?.steps.length ?? 1}
            </Text>
            <TouchableOpacity
              onPress={() =>
                setCurrentStep((p) =>
                  Math.min((routeData?.steps.length ?? 1) - 1, p + 1),
                )
              }
              disabled={currentStep === (routeData?.steps.length ?? 1) - 1}
              style={{
                padding: 2,
                opacity: currentStep === (routeData?.steps.length ?? 1) - 1 ? 0.2 : 1,
              }}
            >
              <ChevronDown size={12} color={C.cyan} />
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </MotiView>
  )}
</AnimatePresence>

{/* Standalone offline banner — only when no instruction card is showing */}
<AnimatePresence>
  {showOfflineBadge && !currentInstruction && (
    <MotiView
      from={{ opacity: 0, translateY: -30 }}
      animate={{ opacity: 1, translateY: 0 }}
      exit={{ opacity: 0, translateY: -30 }}
      transition={{ type: 'spring', damping: 20, stiffness: 220 }}
      style={{
        position:        'absolute',
        top:             insets.top + 10,
        left:            12,
        right:           12,
        zIndex:          20,
        flexDirection:   'row',
        alignItems:      'center',
        justifyContent:  'center',
        gap:             6,
        paddingVertical: 8,
        borderRadius:    12,
        backgroundColor: C.offlineBg,
        borderWidth:     1,
        borderColor:     C.offlineBorder,
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

      {/* ── Recenter ── */}
      {!trackingMode && (
        <MotiView
          from={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          className="absolute right-4 z-20"
          style={{ bottom: sheetOpen ? SH * 0.62 + 16 : 196 }}
        >
          <TouchableOpacity
            onPress={recenter}
            className="w-11 h-11 rounded-full items-center justify-center border"
            style={{
              backgroundColor: C.overlay,
              borderColor:     'rgba(0,229,255,0.3)',
              shadowColor:     C.cyan,
              shadowOffset:    { width: 0, height: 0 },
              shadowOpacity:   0.4,
              shadowRadius:    8,
              elevation:       6,
            }}
          >
            <Navigation2 size={18} color={C.cyan} />
          </TouchableOpacity>
        </MotiView>
      )}

      {/* ── Bottom sheet ── */}
      <Animated.View
        className="absolute bottom-0 left-0 right-0 rounded-tl-3xl rounded-tr-3xl border-t overflow-hidden"
        style={{ height: sheetHeight, backgroundColor: C.surface, borderColor: C.border }}
      >
        <TouchableOpacity
          className="px-4 pt-2.5 pb-2 shrink-0"
          onPress={() => setSheetOpen((o) => !o)}
          activeOpacity={0.8}
        >
          <View className="w-10 h-1 rounded-full self-center mb-3" style={{ backgroundColor: C.border }} />

          <View className="flex-row items-center gap-3 mb-2.5">
            {/* ETA chip */}
            <View
              className="flex-1 flex-row items-center gap-1.5 rounded-[10px] py-2 px-2.5 border"
              style={{ backgroundColor: C.surfaceHi, borderColor: C.border }}
            >
              <Clock size={13} color={C.cyan} />
              <Text className="text-[13px] font-bold flex-1" style={{ color: C.white }}>
                {routeData ? fmtDuration(routeData.total_duration) : '—'}
              </Text>
              <Text className="text-[10px]" style={{ color: C.dimmer }}>ETA</Text>
            </View>

            {/* Distance chip */}
            <View
              className="flex-1 flex-row items-center gap-1.5 rounded-[10px] py-2 px-2.5 border"
              style={{ backgroundColor: C.surfaceHi, borderColor: C.border }}
            >
              <Route size={13} color={C.cyan} />
              <Text className="text-[13px] font-bold flex-1" style={{ color: C.white }}>
                {routeData ? fmtDistance(routeData.total_distance) : '—'}
              </Text>
              <Text className="text-[10px]" style={{ color: C.dimmer }}>Total</Text>
            </View>

            {/* Done chip */}
            <View
              className="flex-1 flex-row items-center gap-1.5 rounded-[10px] py-2 px-2.5 border"
              style={{ backgroundColor: C.surfaceHi, borderColor: C.border }}
            >
              <CheckCircle2 size={13} color={C.green} />
              <Text className="text-[13px] font-bold flex-1" style={{ color: C.green }}>
                {completedCount}/{routeData?.stops.length ?? 0}
              </Text>
              <Text className="text-[10px]" style={{ color: C.dimmer }}>Done</Text>
            </View>

            <View className="pl-1">
              {sheetOpen
                ? <ChevronDown size={16} color={C.dimWhite} />
                : <ChevronUp   size={16} color={C.dimWhite} />
              }
            </View>
          </View>

          {routeData && (
            <View className="h-[3px] rounded-full overflow-hidden" style={{ backgroundColor: C.border }}>
              <View
                className="h-[3px] rounded-full"
                style={{
                  width:           `${(completedCount / routeData.stops.length) * 100}%`,
                  backgroundColor: C.cyan,
                }}
              />
            </View>
          )}
        </TouchableOpacity>

        {nextStop && (
          <View
            className="flex-row items-center px-4 py-2.5 border-t gap-2.5"
            style={{ borderColor: C.border }}
          >
            <View className="flex-row items-center gap-1.5 shrink-0">
              <MapPin size={14} color={C.orange} />
              <Text className="text-xs font-bold" style={{ color: C.orange }}>Next stop</Text>
            </View>
            <Text className="text-[13px] flex-1" style={{ color: C.white }} numberOfLines={1}>
              {nextStop.address}
            </Text>
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
              />
            )}
          />
        )}
      </Animated.View>
    </View>
  )
}