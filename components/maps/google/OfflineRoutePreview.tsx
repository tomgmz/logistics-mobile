import React, { useCallback, useRef, useState } from 'react'
import { ActivityIndicator, PixelRatio, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { ChevronLeft, RefreshCw, WifiOff } from 'lucide-react-native'
import {
  MapView,
  MapColorScheme,
  type MapViewController,
} from '@googlemaps/react-native-navigation-sdk'

import type { CachedRouteGeometry, GeoPoint } from '../../../lib/routeGeometryCache'
import type { DisplayStop } from '../../../lib/navSession'
import { GoogleNavSheet, SHEET_PEEK_H } from './GoogleNavSheet'
import { C } from '../../../theme/navigation.theme'

/**
 * What the driver gets instead of an error screen when navigation can't start.
 *
 * The Google SDK cannot build a route without a connection, so a cold open in a
 * dead zone (app killed and reopened out of coverage) used to end at a red
 * message with a Retry button — no map, no route, no stop list, nothing to work
 * from. This draws the last route the SDK built for the booking, from
 * lib/routeGeometryCache: the line, a marker per stop, and the same trip sheet
 * the live screen uses.
 *
 * It is deliberately NOT navigation and says so on its face. There is no
 * guidance, no rerouting and no snapping; map tiles will be missing wherever the
 * driver hasn't already been, so the line may float on grey. The honest framing
 * matters more than the polish here — a driver who mistakes this for live
 * navigation is worse off than one staring at an error.
 *
 * Confirming stops still works while this is up. That is the point of showing it
 * at all: the confirmations queue offline (lib/offlineQueue) and sync later, so
 * a driver who finishes the run out of coverage loses nothing.
 */

/** Google's zoom scale: the whole world spans 256px at z0, doubling per level. */
const WORLD_PX = 256
const MAX_FIT_ZOOM = 16

/**
 * The SDK speaks `{ lat, lng }`; everything else in this app — the cache, the
 * legs, the geofence check — speaks `{ latitude, longitude }`. The app's spelling
 * is the one that travels, so the conversion happens here, at the one boundary
 * where it has to.
 */
const toLatLng = (p: GeoPoint) => ({ lat: p.latitude, lng: p.longitude })

/**
 * A camera that fits `points`, in the Web-Mercator terms Google's zoom uses.
 *
 * The MapView controller exposes `moveCamera` and `setZoomLevel` but nothing
 * that takes bounds, so the fit is computed here: the span in each axis becomes
 * the zoom that makes it fill the viewport, and the tighter of the two wins.
 * Capped at MAX_FIT_ZOOM so a single-stop run doesn't slam the camera into the
 * pavement, where blank offline tiles look most broken.
 */
export function cameraForPoints(
  points: GeoPoint[],
  viewportW: number,
  viewportH: number,
): { target: GeoPoint; zoom: number } | null {
  if (points.length === 0) return null

  let minLat =  90, maxLat =  -90
  let minLon = 180, maxLon = -180
  for (const p of points) {
    if (p.latitude  < minLat) minLat = p.latitude
    if (p.latitude  > maxLat) maxLat = p.latitude
    if (p.longitude < minLon) minLon = p.longitude
    if (p.longitude > maxLon) maxLon = p.longitude
  }

  const target = {
    latitude:  (minLat + maxLat) / 2,
    longitude: (minLon + maxLon) / 2,
  }

  // Latitude has to go through the Mercator projection before it can be
  // compared against a pixel height; longitude is linear and doesn't.
  const mercator = (lat: number) => {
    const clamped = Math.max(-85.05112878, Math.min(85.05112878, lat))
    const s = Math.sin((clamped * Math.PI) / 180)
    return Math.log((1 + s) / (1 - s)) / 2 / Math.PI
  }

  const latFraction = Math.abs(mercator(maxLat) - mercator(minLat))
  const lonFraction = Math.abs(maxLon - minLon) / 360

  const zoomFor = (fraction: number, px: number) =>
    fraction <= 0 ? MAX_FIT_ZOOM : Math.log2(px / WORLD_PX / fraction)

  const zoom = Math.max(
    2,
    Math.min(
      MAX_FIT_ZOOM,
      Math.floor(Math.min(zoomFor(latFraction, viewportH), zoomFor(lonFraction, viewportW))),
    ),
  )

  return { target, zoom }
}

interface Props {
  /** The cached route: the line to draw and a marker per stop. */
  geometry: CachedRouteGeometry
  /**
   * The stop list and cursor as the SCREEN holds them, not as they were cached.
   * The two diverge the moment the driver confirms a stop from this preview —
   * which they can, offline — and the board has to follow that, not the snapshot.
   */
  stops:    DisplayStop[]
  legIndex: number
  /** True while the retry is in flight, so the button can show it's working. */
  retrying?: boolean
  onRetry:   () => void
  onBack:    () => void
  /** Opens the proof popup for a stop — confirmations queue fine while offline. */
  onConfirmStop: (index: number) => void
}

export function OfflineRoutePreview({
  geometry,
  stops,
  legIndex,
  retrying,
  onRetry,
  onBack,
  onConfirmStop,
}: Props) {
  const insets = useSafeAreaInsets()
  const { width, height } = useWindowDimensions()

  const [sheetH, setSheetH] = useState(SHEET_PEEK_H + insets.bottom)
  const drawnRef      = useRef(false)
  const controllerRef = useRef<MapViewController | null>(null)
  const mapReadyRef   = useRef(false)

  // Fit to the whole run — line and markers together, so a route whose geometry
  // didn't cache still frames its stops.
  const initialCamera = cameraForPoints([...geometry.points, ...geometry.markers], width, height)

  /**
   * Draw the route. Everything here is local: the controller takes coordinates
   * and renders them itself, so none of it needs the network — only the tiles
   * underneath do, and those are Google's problem, not ours.
   *
   * Deliberately gated on BOTH the controller existing and the map reporting
   * ready, because the two arrive in either order and neither alone is enough:
   * `onMapViewControllerCreated` fires when the React ref attaches, which is
   * before the native GoogleMap exists, and overlays added in that window are
   * accepted and silently dropped — no error, no line. Measured on device: the
   * first version drew nothing at all.
   */
  const draw = useCallback(async () => {
    const controller = controllerRef.current
    if (!controller || !mapReadyRef.current || drawnRef.current) return
    drawnRef.current = true

    try {
      if (geometry.points.length > 1) {
        await controller.addPolyline({
          id:     'cached-route',
          points: geometry.points.map(toLatLng),
          color:  C.cyan,
          width:  8,
        })
      }

      for (const [i, marker] of geometry.markers.entries()) {
        await controller.addMarker({
          id:       `cached-stop-${i}`,
          position: toLatLng(marker),
          title:    marker.label,
          snippet:  marker.kind === 'pickup' ? 'Pickup' : `Drop-off ${marker.number ?? i}`,
        })
      }
    } catch {
      // A marker or the line failed to render. The sheet below still lists every
      // stop with its address, which is the part the driver actually reads.
      drawnRef.current = false
    }
  }, [geometry])

  const onControllerCreated = useCallback((controller: MapViewController) => {
    controllerRef.current = controller
    void draw()
  }, [draw])

  const onMapReady = useCallback(() => {
    mapReadyRef.current = true
    void draw()
  }, [draw])

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <MapView
        style={{ flex: 1 }}
        mapColorScheme={MapColorScheme.DARK}
        myLocationEnabled
        myLocationButtonEnabled
        zoomControlsEnabled={false}
        mapToolbarEnabled={false}
        // Pixels, not dp — see sdkBottomClearancePx in GoogleNavigationScreenInner.
        mapPadding={{
          top:    Math.round((insets.top + 96) * PixelRatio.get()),
          bottom: Math.round((sheetH + 12) * PixelRatio.get()),
          left:   0,
          right:  0,
        }}
        initialCameraPosition={
          initialCamera ? { target: toLatLng(initialCamera.target), zoom: initialCamera.zoom } : undefined
        }
        onMapReady={onMapReady}
        onMapViewControllerCreated={onControllerCreated}
      />

      {/* The header says what this is before the driver forms their own theory
          about why the turn card is missing. */}
      <View
        style={{
          position: 'absolute', top: insets.top + 10, left: 14, right: 14, zIndex: 20,
          flexDirection: 'row', alignItems: 'center', gap: 10,
          paddingVertical: 10, paddingHorizontal: 12,
          borderRadius: 16,
          backgroundColor: C.offlineBg,
          borderWidth: 1, borderColor: C.offlineBorder,
        }}
      >
        <TouchableOpacity onPress={onBack} hitSlop={10} accessibilityRole="button" accessibilityLabel="Back">
          <ChevronLeft size={22} color={C.orange} />
        </TouchableOpacity>

        <WifiOff size={17} color={C.orange} />

        <View style={{ flex: 1 }}>
          <Text style={{ color: C.orange, fontSize: 13, fontWeight: '800' }}>
            Offline · route preview only
          </Text>
          <Text style={{ color: C.dimWhite, fontSize: 11, marginTop: 2, lineHeight: 15 }}>
            {geometry.points.length > 1
              ? 'Your last route and stops. No guidance until you reconnect.'
              : 'Your stops only — the route line was not saved. No guidance until you reconnect.'}
          </Text>
        </View>

        <TouchableOpacity
          onPress={onRetry}
          disabled={retrying}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="Retry navigation"
          style={{ opacity: retrying ? 0.5 : 1 }}
        >
          {retrying ? <ActivityIndicator size="small" color={C.orange} /> : <RefreshCw size={19} color={C.orange} />}
        </TouchableOpacity>
      </View>

      {/* The same board as the live screen, so the stop the driver is on, its
          address and its confirm action are all exactly where they expect. */}
      {stops.length > 0 && (
        <GoogleNavSheet
          stops={stops}
          legIndex={legIndex}
          onConfirmStop={onConfirmStop}
          onRestingHeight={(h) => setSheetH(h)}
        />
      )}
    </View>
  )
}
