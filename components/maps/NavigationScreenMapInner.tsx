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
  StatusBar,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'
import MapboxGL from '@rnmapbox/maps'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { AnimatePresence, MotiView } from 'moti'
import { useRouter } from 'expo-router'
import { AlertCircle, CheckCircle2, Navigation2, WifiOff } from 'lucide-react-native'

import { useGPS }   from '../../hooks/useGps'
import { useRoute } from '../../hooks/useRoute'

import { TurnCard }    from './TurnCard'
import { BottomSheet } from './BottomSheet'
import {
  TrafficLayer,
  OriginMarker,
  StopMarkers,
  DriverMarker,
} from './MapLayer'

import { C, MAPBOX_STYLE } from '../../theme/navigation.theme'
import { toCoord }          from '../../utils/geo'
import type { Stop }        from '../../types/navigation.types'

MapboxGL.setAccessToken(process.env.EXPO_PUBLIC_MAPBOX_TOKEN ?? '')

interface NavigationScreenProps {
  bookingId: string
}

export default function NavigationScreenMapInner({ bookingId }: NavigationScreenProps) {
  const insets    = useSafeAreaInsets()
  const router    = useRouter()
  const cameraRef = useRef<MapboxGL.Camera>(null)

  const [mapReady,      setMapReady]      = useState(false)
  const [trackingMode,  setTrackingMode]  = useState(true)
  const [sheetOpen,     setSheetOpen]     = useState(false)
  const [cameraBearing, setCameraBearing] = useState(0)

  const trackingModeRef = useRef(trackingMode)
  useEffect(() => { trackingModeRef.current = trackingMode }, [trackingMode])

  const sheetAnim = useRef(new Animated.Value(0)).current

  useEffect(() => {
    Animated.spring(sheetAnim, {
      toValue:         sheetOpen ? 1 : 0,
      useNativeDriver: false,
      tension:         80,
      friction:        12,
    }).start()
  }, [sheetOpen, sheetAnim])

  const fitMapToRoute = useCallback((polyline: any[]) => {
    if (!polyline?.length) return
    const lngs = polyline.map((p: any) => p.longitude)
    const lats  = polyline.map((p: any) => p.latitude)
    cameraRef.current?.fitBounds(
      [Math.max(...lngs), Math.max(...lats)],
      [Math.min(...lngs), Math.min(...lats)],
      [220, 60, 320, 60],
      800,
    )
  }, [])

  const onLocationUpdateRef = useRef<((pos: { latitude: number; longitude: number }) => void) | undefined>(undefined)

  const { userLocation, userLocationRef, heading } = useGPS({
    cameraRef,
    trackingModeRef,
    onLocationUpdateRef,
    onError: (msg) => { console.warn('[GPS]', msg) },
  })

  const {
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
  } = useRoute({
    bookingId,
    userLocation,
    userLocationRef,
    mapReady,
    onRouteReady: fitMapToRoute,
  })

  useEffect(() => {
    onLocationUpdateRef.current = onLocationUpdate
  }, [onLocationUpdate])

  const handleMapReady = useCallback(() => setMapReady(true), [])

  const handleCameraChanged = useCallback((state: any) => {
    setCameraBearing(state.properties.heading ?? 0)
  }, [])

  const recenter = useCallback(() => {
    setTrackingMode(true)
    if (userLocation) {
      cameraRef.current?.setCamera({
        centerCoordinate:  toCoord(userLocation),
        heading,
        pitch:             45,
        zoomLevel:         17,
        animationDuration: 600,
      })
    }
  }, [userLocation, heading])

  const nextStop       = useMemo(() => routeData?.stops.find((s) => s.status === 'pending'), [routeData])
  const completedCount = useMemo(() => routeData?.stops.filter((s) => s.status === 'delivered').length ?? 0, [routeData])

  const stopListData: Stop[] = useMemo(() => {
    if (!routeData) return []
    return [
      {
        destination_id:           '__origin__',
        address:                  routeData.origin.address,
        latitude:                 routeData.origin.latitude,
        longitude:                routeData.origin.longitude,
        optimized_sequence_order: 0,
        status:                   'delivered',
      },
      ...routeData.stops,
    ]
  }, [routeData])

  const trafficSegments = useMemo(() => {
    if (!routeData || !displayPolyline.length) return routeData?.trafficSegments ?? []
    return routeData.trafficSegments
  }, [routeData, displayPolyline])

  const handleConfirmArrival = useCallback(() => {
    if (nearbyTarget === 'pickup') {
      markPickupArrived()
    } else if (nearbyTarget === 'dropoff' && nextStop) {
      markStopArrived(nextStop.destination_id)
    }
  }, [nearbyTarget, nextStop, markPickupArrived, markStopArrived])

  const showOffline = isOffline || usingCache

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: C.bg, gap: 12 }}>
        <ActivityIndicator size="large" color={C.cyan} />
        <Text style={{ color: C.dimWhite, fontSize: 14 }}>Loading route…</Text>
      </View>
    )
  }

  if (error) {
    return (
      <View
        style={{
          flex: 1, alignItems: 'center', justifyContent: 'center',
          paddingHorizontal: 32, backgroundColor: C.bg,
          paddingTop: insets.top, gap: 12,
        }}
      >
        <AlertCircle size={40} color={C.red} />
        <Text style={{ color: C.red, fontSize: 14, textAlign: 'center', lineHeight: 22 }}>{error}</Text>
        <TouchableOpacity
          onPress={() => fetchRoute(false, false)}
          style={{
            marginTop: 12, paddingVertical: 10, paddingHorizontal: 28,
            borderRadius: 14, backgroundColor: C.surfaceHi,
            borderWidth: 1, borderColor: C.border,
          }}
        >
          <Text style={{ color: C.cyan, fontSize: 14, fontWeight: '700' }}>Retry</Text>
        </TouchableOpacity>
      </View>
    )
  }

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <StatusBar barStyle="dark-content" backgroundColor="transparent" translucent />

      <MapboxGL.MapView
        style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
        styleURL={MAPBOX_STYLE}
        logoEnabled={false}
        attributionEnabled={false}
        compassEnabled={false}
        scaleBarEnabled={false}
        onDidFinishLoadingMap={handleMapReady}
        onTouchStart={() => setTrackingMode(false)}
        onCameraChanged={handleCameraChanged}
      >
        <MapboxGL.Camera
          ref={cameraRef}
          defaultSettings={
            userLocation
              ? { centerCoordinate: toCoord(userLocation), zoomLevel: 13, pitch: 0 }
              : { zoomLevel: 13 }
          }
        />

        {routeData && <TrafficLayer segments={trafficSegments} />}

        {routeData?.origin && <OriginMarker origin={routeData.origin} />}

        {routeData?.stops && (
          <StopMarkers stops={routeData.stops} nextStopId={nextStop?.destination_id} />
        )}

        {userLocation && (
          <DriverMarker
            location={userLocation}
            heading={heading}
            cameraBearing={cameraBearing}
          />
        )}
      </MapboxGL.MapView>

      <AnimatePresence>
        {routeData?.steps[currentStep] && (
          <TurnCard
            key="turn-card"
            instruction={routeData.steps[currentStep]}
            currentStep={currentStep}
            totalSteps={routeData.steps.length}
            onStepBack={() => setCurrentStep((p) => Math.max(0, p - 1))}
            onStepForward={() => setCurrentStep((p) => Math.min(routeData.steps.length - 1, p + 1))}
            onBack={() => router.back()}
            showOffline={showOffline}
            isOffline={isOffline}
            usingCache={usingCache}
            isRerouting={isRerouting}
          />
        )}
      </AnimatePresence>

      {/* ── Offline banner ── */}
      <AnimatePresence>
        {showOffline && !routeData?.steps[currentStep] && (
          <MotiView
            from={{ opacity: 0, translateY: -30 }}
            animate={{ opacity: 1, translateY: 0 }}
            exit={{ opacity: 0, translateY: -30 }}
            transition={{ type: 'spring', damping: 20, stiffness: 220 }}
            style={{
              position: 'absolute', top: insets.top + 10,
              left: 12, right: 12, zIndex: 20,
              flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
              gap: 6, paddingVertical: 9, borderRadius: 12,
              backgroundColor: C.offlineBg,
              borderWidth: 1, borderColor: C.offlineBorder,
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

      {/* ── Manual confirm arrival button ── */}
      <AnimatePresence>
        {nearbyTarget && (
          <MotiView
            from={{ opacity: 0, translateY: 20 }}
            animate={{ opacity: 1, translateY: 0 }}
            exit={{ opacity: 0, translateY: 20 }}
            transition={{ type: 'spring', damping: 20, stiffness: 220 }}
            style={{
              position: 'absolute',
              bottom:   sheetOpen ? 16 : 210,
              left:     16,
              right:    16,
              zIndex:   25,
            }}
          >
            <TouchableOpacity
              onPress={handleConfirmArrival}
              activeOpacity={0.85}
              style={{
                flexDirection:   'row',
                alignItems:      'center',
                justifyContent:  'center',
                gap:             8,
                paddingVertical: 14,
                borderRadius:    16,
                backgroundColor: nearbyTarget === 'pickup' ? C.cyan : C.green ?? '#22c55e',
                shadowColor:     nearbyTarget === 'pickup' ? C.cyan : '#22c55e',
                shadowOffset:    { width: 0, height: 0 },
                shadowOpacity:   0.4,
                shadowRadius:    10,
                elevation:       8,
              }}
            >
              <CheckCircle2 size={18} color="#000" />
              <Text style={{ color: '#000', fontSize: 14, fontWeight: '700' }}>
                {nearbyTarget === 'pickup' ? 'Confirm Pickup' : 'Confirm Delivery'}
                {'  ·  '}
                <Text style={{ fontWeight: '400' }}>{distanceToTarget}m away</Text>
              </Text>
            </TouchableOpacity>
          </MotiView>
        )}
      </AnimatePresence>

      {/* ── Recenter button ── */}
      <AnimatePresence>
        {!trackingMode && (
          <MotiView
            from={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.8 }}
            transition={{ type: 'spring', damping: 18, stiffness: 200 }}
            style={{
              position: 'absolute',
              right:    16,
              bottom:   sheetOpen ? 16 : 200,
              zIndex:   20,
            }}
          >
            <TouchableOpacity
              onPress={recenter}
              style={{
                width: 44, height: 44, borderRadius: 22,
                alignItems: 'center', justifyContent: 'center',
                backgroundColor: C.overlay,
                borderWidth: 1, borderColor: C.cyanGlow,
                shadowColor: C.cyan, shadowOffset: { width: 0, height: 0 },
                shadowOpacity: 0.4, shadowRadius: 8, elevation: 6,
              }}
            >
              <Navigation2 size={18} color={C.cyan} />
            </TouchableOpacity>
          </MotiView>
        )}
      </AnimatePresence>

      <BottomSheet
        routeData={routeData}
        nextStop={nextStop}
        completedCount={completedCount}
        sheetOpen={sheetOpen}
        sheetAnim={sheetAnim}
        stopListData={stopListData}
        onToggle={() => setSheetOpen((o) => !o)}
      />
    </View>
  )
}