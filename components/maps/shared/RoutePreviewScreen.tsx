import React, { useCallback, useEffect, useRef, useState } from 'react'
import {
  ActivityIndicator,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { MapView, type MapViewController } from '@googlemaps/react-native-navigation-sdk'
import { ChevronLeft, Eye, TriangleAlert } from 'lucide-react-native'

import api from '../../../lib/api/auth.api'
import { loadBookingCache } from '../../../lib/navCache'
import { decodePolyline } from '../../../utils/geo'
import { FONTS } from '../../../lib/config/fonts'
import type { LatLng } from '../../../types/navigation.types'

/**
 * The route, to look at — no guidance, no GPS, no confirmations.
 *
 * This is what a driver gets before the scheduled day: enough to judge the run
 * (how far, which way, what order) without being able to touch the booking. It
 * shares no state with the navigation screens, so there is no path from here to
 * a pickup or a drop-off confirmation.
 *
 * Drawn with the Google Maps SDK's plain MapView — the same provider the
 * navigation screens use, not a second map stack just for the preview.
 *
 * The line runs from the PICKUP through the drop-offs, not from wherever the
 * driver happens to be standing: this previews the job, not a trip.
 */

interface Props {
  bookingId: string
  onBack:    () => void
}

interface Destination {
  destination_id: string
  address:        string
  sequence_order: number
  status:         string
  latitude:       number | null
  longitude:      number | null
}

interface Booking {
  origin:            string
  origin_latitude:   number | null
  origin_longitude:  number | null
  booking_destinations?: Destination[]
}

interface PreviewStop {
  id:        string
  address:   string
  latitude:  number
  longitude: number
  delivered: boolean
}

const C = {
  bg:      '#000000',
  card:    '#0e1010',
  line:    '#424242',
  white:   '#ffffff',
  faint:   '#818181',
  cyan:    '#4df9ed',
  cyanDim: 'rgba(77,249,237,0.19)',
  green:   '#3af626',
  red:     '#f62626',
}

/** Our coords are {latitude, longitude}; the Google SDK speaks {lat, lng}. */
const g = (p: LatLng) => ({ lat: p.latitude, lng: p.longitude })

/**
 * The zoom that fits a bounding box into a viewport — the Web Mercator maths
 * Google's own `fitBounds` uses.
 *
 * The SDK's MapViewController has no bounds-fitting call (only `moveCamera` and
 * `setZoomLevel`), so the fit has to be computed here. Doing it from the span
 * alone gets it wrong: a route that is wide but short needs a different zoom
 * than a tall narrow one, and that depends on the viewport's own proportions.
 */
const WORLD_PX = 256
const MAX_ZOOM = 18

function latRad(lat: number): number {
  const sin   = Math.sin((lat * Math.PI) / 180)
  const radX2 = Math.log((1 + sin) / (1 - sin)) / 2
  return Math.max(Math.min(radX2, Math.PI), -Math.PI) / 2
}

function fitZoom(
  bounds: { north: number; south: number; east: number; west: number },
  viewport: { width: number; height: number },
): number {
  const latFraction = (latRad(bounds.north) - latRad(bounds.south)) / Math.PI
  const lngDiff     = bounds.east - bounds.west
  const lngFraction = (lngDiff < 0 ? lngDiff + 360 : lngDiff) / 360

  // A degenerate span (one stop, or stops on top of each other) would divide by
  // ~0 and shoot to max zoom; clamp both fractions to something a street-level
  // view can represent.
  const latZoom = Math.log2(viewport.height / WORLD_PX / Math.max(latFraction, 1e-6))
  const lngZoom = Math.log2(viewport.width  / WORLD_PX / Math.max(lngFraction, 1e-6))

  return Math.min(latZoom, lngZoom, MAX_ZOOM)
}

export default function RoutePreviewScreen({ bookingId, onBack }: Props) {
  const insets = useSafeAreaInsets()

  const controller = useRef<MapViewController | null>(null)
  const drawnRef   = useRef(false)

  const [loading,  setLoading]  = useState(true)
  const [error,    setError]    = useState<string | null>(null)
  const [origin,   setOrigin]   = useState<{ latitude: number; longitude: number; address: string } | null>(null)
  const [stops,    setStops]    = useState<PreviewStop[]>([])
  const [polyline, setPolyline] = useState<LatLng[]>([])
  const [mapReady, setMapReady] = useState(false)
  // Measured from layout: the fit below needs the real viewport, not a guess.
  const [viewport, setViewport] = useState({ width: 0, height: 0 })

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)

    let booking: Booking | null = null
    try {
      const { data } = await api.get(`/booking/${bookingId}`)
      booking = data.data
    } catch {
      booking = await loadBookingCache<Booking>(bookingId)
    }

    if (!booking) {
      setError('Could not load this booking.')
      setLoading(false)
      return
    }

    if (booking.origin_latitude == null || booking.origin_longitude == null) {
      setError('This booking has no pickup coordinates to map.')
      setLoading(false)
      return
    }

    const start = {
      latitude:  booking.origin_latitude,
      longitude: booking.origin_longitude,
      address:   booking.origin,
    }

    const mapped: PreviewStop[] = [...(booking.booking_destinations ?? [])]
      .filter((d) => d.latitude != null && d.longitude != null)
      .sort((a, b) => a.sequence_order - b.sequence_order)
      .map((d) => ({
        id:        d.destination_id,
        address:   d.address,
        latitude:  d.latitude as number,
        longitude: d.longitude as number,
        delivered: d.status === 'delivered',
      }))

    setOrigin(start)
    setStops(mapped)

    // The pins already make the map useful, so a failed directions call degrades
    // to "no line drawn" rather than to an error screen.
    if (mapped.length > 0) {
      try {
        const intermediates = mapped.slice(0, -1).map((s) => ({
          location: { latLng: { latitude: s.latitude, longitude: s.longitude } },
        }))
        const last = mapped[mapped.length - 1]

        const { data } = await api.post('/directions', {
          origin:      { location: { latLng: { latitude: start.latitude, longitude: start.longitude } } },
          destination: { location: { latLng: { latitude: last.latitude, longitude: last.longitude } } },
          ...(intermediates.length > 0 && { intermediates }),
          travelMode:        'DRIVE',
          routingPreference: 'TRAFFIC_AWARE',
          units:             'METRIC',
          // No traffic colouring, no snapping: this is a still picture.
          fast:              true,
          extraComputations: [],
        })

        const encoded = data?.data?.routes?.[0]?.polyline?.encodedPolyline
        if (encoded) setPolyline(decodePolyline(encoded))
      } catch {
        // Pins only.
      }
    }

    setLoading(false)
  }, [bookingId])

  useEffect(() => { load() }, [load])

  // Markers and the line go on once, when both the map and the booking are in
  // hand. Adding them twice would stack duplicates on the same coordinates.
  useEffect(() => {
    const map = controller.current
    if (!map || !mapReady || !origin || drawnRef.current) return
    drawnRef.current = true

    void map.addMarker({
      id:       'origin',
      position: g(origin),
      title:    'Pickup',
      snippet:  origin.address,
    })

    stops.forEach((s, i) => {
      void map.addMarker({
        id:       s.id,
        position: g(s),
        title:    `Drop-off ${i + 1}`,
        snippet:  s.address,
      })
    })
  }, [mapReady, origin, stops])

  // Drawing the route line is separate: it arrives after the markers do, once
  // /directions answers.
  useEffect(() => {
    const map = controller.current
    if (!map || !mapReady || polyline.length < 2) return

    void map.addPolyline({
      // A stable id means a redraw replaces the line rather than layering another.
      id:     'preview-route',
      points: polyline.map(g),
      color:  C.cyan,
      width:  8,
    })
  }, [mapReady, polyline])

  // Framing is its own effect, deliberately NOT one-shot: the route line lands
  // after the pins do and widens the bounds, and the viewport isn't known until
  // layout. Both have to be able to re-frame.
  useEffect(() => {
    const map = controller.current
    if (!map || !mapReady || !origin || viewport.height === 0) return

    const points: LatLng[] = polyline.length > 0
      ? polyline
      : [origin, ...stops.map((s) => ({ latitude: s.latitude, longitude: s.longitude }))]

    const lats = points.map((p) => p.latitude)
    const lngs = points.map((p) => p.longitude)
    const north = Math.max(...lats), south = Math.min(...lats)
    const east  = Math.max(...lngs), west  = Math.min(...lngs)

    // Fit against the area the overlays leave free, not the whole screen, so the
    // route never ends up tucked behind the header or the footer strip. This is
    // what padding means to fitBounds; we apply it to the viewport rather than
    // via setPadding so it isn't counted twice.
    const usable = {
      width:  Math.max(viewport.width  - 64, 1),
      height: Math.max(viewport.height - (insets.top + 60) - (insets.bottom + 60), 1),
    }

    map.moveCamera({
      target:  g({ latitude: (north + south) / 2, longitude: (east + west) / 2 }),
      zoom:    fitZoom({ north, south, east, west }, usable),
      tilt:    0,
      bearing: 0,
    })
  }, [mapReady, origin, stops, polyline, viewport, insets.top, insets.bottom])

  // A retry has to be able to redraw.
  const retry = useCallback(() => {
    drawnRef.current = false
    setPolyline([])
    load()
  }, [load])

  return (
    <View
      style={s.root}
      onLayout={(e) => {
        const { width, height } = e.nativeEvent.layout
        setViewport({ width, height })
      }}
    >
      <StatusBar barStyle="light-content" backgroundColor="transparent" translucent />

      <MapView
        style={StyleSheet.absoluteFill}
        onMapViewControllerCreated={(c) => { controller.current = c; setMapReady(true) }}
        // No initialCameraPosition: it is read once at mount, and the booking
        // that decides where to look has not loaded by then. The framing effect
        // owns the camera instead.
      />

      {/* Header */}
      <View style={[s.header, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity
          onPress={onBack}
          activeOpacity={0.75}
          accessibilityRole="button"
          accessibilityLabel="Back to booking details"
          style={s.backBtn}
        >
          <ChevronLeft size={20} color={C.white} strokeWidth={2} />
        </TouchableOpacity>

        <View style={s.titleWrap}>
          <Text style={s.title}>Route preview</Text>
          <View style={s.viewOnly}>
            <Eye size={11} color={C.cyan} />
            <Text style={s.viewOnlyText}>View only</Text>
          </View>
        </View>
      </View>

      {loading && (
        <View style={s.overlay}>
          <ActivityIndicator size="large" color={C.cyan} />
          <Text style={s.overlayText}>Drawing the route…</Text>
        </View>
      )}

      {error && !loading && (
        <View style={s.overlay}>
          <TriangleAlert size={36} color={C.faint} />
          <Text style={s.overlayText}>{error}</Text>
          <TouchableOpacity onPress={retry} activeOpacity={0.8} style={s.retryBtn}>
            <Text style={s.retryText}>Retry</Text>
          </TouchableOpacity>
        </View>
      )}

      {!loading && !error && (
        <View style={[s.footer, { paddingBottom: insets.bottom + 14 }]}>
          <Text style={s.footerText}>
            Pickup + {stops.length} drop-off{stops.length === 1 ? '' : 's'}
            {polyline.length === 0 ? ' · route line unavailable offline' : ''}
          </Text>
        </View>
      )}
    </View>
  )
}

const s = StyleSheet.create({
  root: {
    flex:            1,
    backgroundColor: C.bg,
  },

  header: {
    position:          'absolute',
    top:               0,
    left:              0,
    right:             0,
    flexDirection:     'row',
    alignItems:        'center',
    gap:               11,
    paddingHorizontal: 19,
    paddingBottom:     12,
  },
  backBtn: {
    width:           35,
    height:          35,
    borderRadius:    17.5,
    backgroundColor: C.card,
    borderWidth:     0.5,
    borderColor:     C.line,
    alignItems:      'center',
    justifyContent:  'center',
  },
  titleWrap: {
    flexDirection: 'row',
    alignItems:    'center',
    gap:           8,
    flex:          1,
  },
  title: {
    color:      C.white,
    fontSize:   20,
    fontFamily: FONTS.spartan.medium,
    // The map shows through behind it, so give the text its own weight.
    textShadowColor:  'rgba(0,0,0,0.9)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 6,
  },
  viewOnly: {
    flexDirection:     'row',
    alignItems:        'center',
    gap:               4,
    paddingHorizontal: 8,
    height:            20,
    borderRadius:      16,
    backgroundColor:   C.cyanDim,
    borderWidth:       0.5,
    borderColor:       C.cyan,
  },
  viewOnlyText: {
    color:      C.cyan,
    fontSize:   11,
    fontWeight: '700',
  },

  overlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems:        'center',
    justifyContent:    'center',
    gap:               12,
    paddingHorizontal: 32,
    backgroundColor:   'rgba(0,0,0,0.72)',
  },
  overlayText: {
    color:     C.faint,
    fontSize:  14,
    textAlign: 'center',
  },
  retryBtn: {
    marginTop:         4,
    paddingVertical:   10,
    paddingHorizontal: 28,
    borderRadius:      10,
    backgroundColor:   C.cyanDim,
    borderWidth:       1,
    borderColor:       C.cyan,
  },
  retryText: {
    color:      C.cyan,
    fontSize:   14,
    fontWeight: '700',
  },

  footer: {
    position:          'absolute',
    left:              0,
    right:             0,
    bottom:            0,
    paddingHorizontal: 24,
    paddingTop:        12,
    backgroundColor:   'rgba(0,0,0,0.75)',
  },
  footerText: {
    color:     C.faint,
    fontSize:  12,
    textAlign: 'center',
  },
})
