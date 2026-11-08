import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Keyboard,
  Pressable,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { MapView, MapColorScheme, type MapViewController } from '@googlemaps/react-native-navigation-sdk'
import { ChevronLeft, LocateFixed, MapPin, Plus, X } from 'lucide-react-native'
import * as Location from 'expo-location'

import api from '../../../lib/api/auth.api'
import { readCurrentFix } from '../../../lib/stopGeofence'
import { FONTS } from '../../../lib/config/fonts'
import { PH_MIN_ZOOM, useKeepCameraInPhilippines } from '../../../lib/philippinesMap'
import { fitZoom } from '../../../lib/mapFit'
import { formatDuration } from '../../../lib/duration'
import { decodePolyline } from '../../../utils/geo'

/**
 * The home screen's Maps shortcut: a map the driver can plan a drive on.
 *
 * Not tied to any booking: no guidance, no confirmations, nothing sent to the
 * office. The driver sets a start (their current location unless they type
 * one) and up to three destinations, and sees the road route through them in
 * that order, with the total time and distance and the time to each stop.
 * The active delivery is still reached from its order card.
 *
 * Search goes through our /places proxy and the route through /directions,
 * because the app's key is restricted to the native Maps SDK. Both are
 * Philippines only.
 */

interface Props {
  onBack: () => void
  /** A point to open on (e.g. a hand-over point); it becomes the first destination. */
  pin?: { latitude: number; longitude: number; label: string }
}

interface Suggestion {
  placeId:   string
  primary:   string
  secondary: string
}

interface Place {
  address:   string
  latitude:  number
  longitude: number
}

interface Field {
  /** Stable key: rows are removed from the middle. */
  key:   string
  text:  string
  place: Place | null
}

interface RouteResult {
  points:    { latitude: number; longitude: number }[]
  seconds:   number
  meters:    number
  /** Seconds for each leg, start → destination 1, 1 → 2, … */
  legs:      number[]
}

const C = {
  bg:      '#000000',
  card:    '#0e1010',
  line:    '#424242',
  white:   '#ffffff',
  faint:   '#818181',
  cyan:    '#4df9ed',
  cyanDim: 'rgba(77,249,237,0.19)',
  error:   '#f62626',
}

// Metro Manila, until the driver's own position is known.
const DEFAULT_CENTER   = { lat: 14.5995, lng: 120.9842 }
const MIN_QUERY        = 3
const DEBOUNCE_MS      = 300
const MAX_DESTINATIONS = 3
const ROUTE_LINE_ID    = 'browse-route'
const MARKER_IDS       = ['start', 'dest-1', 'dest-2', 'dest-3']

/** One token per search, so Google bills the typing and the pick as one session. */
function newSessionToken(): string {
  let token = ''
  for (let i = 0; i < 32; i++) token += Math.floor(Math.random() * 16).toString(16)
  return token
}

let keySeq = 0
const newField = (place: Place | null = null): Field => ({
  key:   `f${++keySeq}`,
  text:  place?.address ?? '',
  place,
})

/** Google's "1234s" → 1234. */
const secondsOf = (d: unknown) => (typeof d === 'string' ? parseInt(d, 10) || 0 : 0)

function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)} m`
  return `${(meters / 1000).toFixed(meters < 100_000 ? 1 : 0)} km`
}

/** A leg under a minute still reads as a minute, not "0 min". */
const formatLeg = (seconds: number) => formatDuration(Math.max(1, Math.round(seconds / 60)))

export default function BrowseMapScreen({ onBack, pin }: Props) {
  const insets = useSafeAreaInsets()

  const controller = useRef<MapViewController | null>(null)
  // Philippines only: pull the camera back if it is panned out of the country.
  useKeepCameraInPhilippines(controller)
  const session    = useRef(newSessionToken())
  const requestId  = useRef(0)
  const routeReq   = useRef(0)
  const timer      = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inputs     = useRef<Record<string, TextInput | null>>({})

  // Index 0 is the start; an empty start means "Current location".
  const [fields, setFields] = useState<Field[]>(() => [
    newField(),
    newField(pin ? { address: pin.label, latitude: pin.latitude, longitude: pin.longitude } : null),
  ])
  const [active,      setActive]      = useState<number | null>(null)
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [searching,   setSearching]   = useState(false)
  // The last search came back empty: said out loud, not shown as a blank.
  const [noResults,   setNoResults]   = useState(false)
  const [me,          setMe]          = useState<{ latitude: number; longitude: number } | null>(null)
  const [locating,    setLocating]    = useState(false)
  const [notice,      setNotice]      = useState<string | null>(null)
  const [canShowMe,   setCanShowMe]   = useState(false)
  const [mapReady,    setMapReady]    = useState(false)
  const [route,       setRoute]       = useState<RouteResult | null>(null)
  const [routing,     setRouting]     = useState(false)
  const [routeError,  setRouteError]  = useState<string | null>(null)
  const [viewport,    setViewport]    = useState({ width: 0, height: 0 })
  const [cardH,       setCardH]       = useState(0)
  const [footerH,     setFooterH]     = useState(0)

  /**
   * The map, but only once it can take commands. The controller arrives when
   * the ref attaches, before the native map exists, and a camera move in that
   * window rejects with "Make sure the map view has been initialized".
   */
  const liveMap = () => (mapReady ? controller.current : null)

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  // The blue dot needs permission; it is not asked for here, only on "Current location".
  useEffect(() => {
    Location.getForegroundPermissionsAsync()
      .then(({ status }) => setCanShowMe(status === 'granted'))
      .catch(() => {})
  }, [])

  const start: Place | null = fields[0].place
    ?? (me ? { address: 'Current location', latitude: me.latitude, longitude: me.longitude } : null)
  const stops = useMemo(
    () => fields.slice(1).map((f) => f.place).filter((p): p is Place => !!p),
    [fields],
  )

  const goToCurrentLocation = useCallback(async (quiet = false) => {
    setLocating(true)
    setNotice(null)
    const fix = await readCurrentFix()
    setLocating(false)
    if (!fix) {
      if (!quiet) setNotice('Could not read your current location.')
      return
    }
    setMe({ latitude: fix.latitude, longitude: fix.longitude })
    setCanShowMe(true)
    if (!quiet) controller.current?.moveCamera({ target: { lat: fix.latitude, lng: fix.longitude }, zoom: 15 })
  }, [])

  // Look for the driver straight away (the start defaults to them).
  useEffect(() => { void goToCurrentLocation(true) }, [goToCurrentLocation])

  // ── Search ────────────────────────────────────────────────────────────────

  const search = useCallback(async (text: string) => {
    const id = ++requestId.current
    setSearching(true)
    try {
      const { data } = await api.post('/places/autocomplete', {
        input:        text,
        sessionToken: session.current,
        ...(me && { near: me }),
      })
      if (id !== requestId.current) return
      const list: Suggestion[] = Array.isArray(data?.data) ? data.data : []
      setSuggestions(list)
      setNoResults(list.length === 0)
      setNotice(null)
    } catch {
      if (id !== requestId.current) return
      setSuggestions([])
      setNoResults(false)
      setNotice('Place search is unavailable right now.')
    } finally {
      if (id === requestId.current) setSearching(false)
    }
  }, [me])

  const stopSearch = () => {
    requestId.current++
    if (timer.current) clearTimeout(timer.current)
    setSuggestions([])
    setSearching(false)
    setNoResults(false)
  }

  const onChangeText = (index: number, text: string) => {
    // Typing replaces the place: the route waits until a new one is picked.
    setFields((prev) => prev.map((f, i) => (i === index ? { ...f, text, place: null } : f)))
    setNoResults(false)
    if (timer.current) clearTimeout(timer.current)
    if (text.trim().length < MIN_QUERY) {
      requestId.current++
      setSuggestions([])
      setSearching(false)
      return
    }
    timer.current = setTimeout(() => void search(text.trim()), DEBOUNCE_MS)
  }

  const pick = async (s: Suggestion) => {
    const index = active
    if (index == null) return
    Keyboard.dismiss()
    setSuggestions([])
    setSearching(true)
    try {
      const { data } = await api.post('/places/details', {
        placeId:      s.placeId,
        sessionToken: session.current,
      })
      const found: Place = data.data
      setFields((prev) => prev.map((f, i) => (i === index ? { ...f, text: found.address, place: found } : f)))
      setActive(null)
    } catch {
      setNotice('Could not open that place. Try another result.')
    } finally {
      setSearching(false)
      // The session ends with a pick; the next search starts a new one.
      session.current = newSessionToken()
    }
  }

  /** The start goes back to the driver's own position. */
  const useCurrentLocationAsStart = () => {
    Keyboard.dismiss()
    stopSearch()
    setActive(null)
    setFields((prev) => prev.map((f, i) => (i === 0 ? { ...f, text: '', place: null } : f)))
    if (!me) void goToCurrentLocation()
  }

  const clearField = (index: number) => {
    stopSearch()
    setNotice(null)
    setFields((prev) => {
      // A second or third destination row goes away; the first one is emptied.
      if (index >= 2) return prev.filter((_, i) => i !== index)
      return prev.map((f, i) => (i === index ? { ...f, text: '', place: null } : f))
    })
    if (index >= 2) setActive(null)
  }

  const addDestination = () => {
    if (fields.length - 1 >= MAX_DESTINATIONS) return
    const f = newField()
    setFields((prev) => [...prev, f])
    setActive(fields.length)
    // Focus once the row exists.
    setTimeout(() => inputs.current[f.key]?.focus(), 50)
  }

  // ── Route ─────────────────────────────────────────────────────────────────

  // Rounded so a small GPS wobble doesn't ask Google for the same route again.
  const routeKey = start && stops.length > 0
    ? [start, ...stops].map((p) => `${p.latitude.toFixed(4)},${p.longitude.toFixed(4)}`).join('|')
    : null

  useEffect(() => {
    const id = ++routeReq.current
    setRouteError(null)
    if (!routeKey || !start) {
      setRoute(null)
      setRouting(false)
      return
    }
    const ll = (p: Place) => ({ location: { latLng: { latitude: p.latitude, longitude: p.longitude } } })
    setRouting(true)
    void (async () => {
      try {
        const { data } = await api.post('/directions', {
          origin:      ll(start),
          destination: ll(stops[stops.length - 1]),
          ...(stops.length > 1 && { intermediates: stops.slice(0, -1).map(ll) }),
          travelMode:        'DRIVE',
          routingPreference: 'TRAFFIC_AWARE',
          units:             'METRIC',
          // A picture of the route: no traffic colouring, no road snapping.
          fast:              true,
          extraComputations: [],
        })
        if (id !== routeReq.current) return
        const r = data?.data?.routes?.[0]
        const encoded = r?.polyline?.encodedPolyline
        if (!encoded) {
          // Google found no road between these places (e.g. an island with no ferry).
          setRoute(null)
          setRouteError('No road route between these places. They are still marked.')
          return
        }
        const legs: any[] = Array.isArray(r.legs) ? r.legs : []
        setRoute({
          points:  decodePolyline(encoded),
          seconds: secondsOf(r.duration),
          meters:  Number(r.distanceMeters) || 0,
          legs:    legs.map((l) => secondsOf(l?.duration)),
        })
      } catch {
        if (id !== routeReq.current) return
        setRoute(null)
        setRouteError('Could not get a route right now. The places are still marked.')
      } finally {
        if (id === routeReq.current) setRouting(false)
      }
    })()
    // routeKey stands for start + stops.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeKey])

  // ── Drawing ───────────────────────────────────────────────────────────────

  // Markers: a typed start and each destination. The driver's own position is
  // the blue dot, so a "Current location" start gets no marker.
  useEffect(() => {
    const map = liveMap()
    if (!map) return
    for (const id of MARKER_IDS) { try { map.removeMarker(id) } catch { /* not there */ } }
    if (fields[0].place) {
      void map.addMarker({
        id:       'start',
        position: { lat: fields[0].place.latitude, lng: fields[0].place.longitude },
        title:    'Start',
        snippet:  fields[0].place.address,
      }).catch(() => {})
    }
    fields.slice(1).forEach((f, i) => {
      if (!f.place) return
      void map.addMarker({
        id:       `dest-${i + 1}`,
        position: { lat: f.place.latitude, lng: f.place.longitude },
        title:    `Destination ${i + 1}`,
        snippet:  f.place.address,
      }).catch(() => {})
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady, fields])

  useEffect(() => {
    const map = liveMap()
    if (!map) return
    try { map.removePolyline(ROUTE_LINE_ID) } catch { /* not there */ }
    if (!route || route.points.length < 2) return
    void map.addPolyline({
      id:     ROUTE_LINE_ID,
      points: route.points.map((p) => ({ lat: p.latitude, lng: p.longitude })),
      color:  C.cyan,
      width:  8,
    }).catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady, route])

  // Framing: the whole route (or the marked places) inside the area the header
  // card and the footer leave free. One place alone opens close up on it.
  const placesKey = [fields[0].place, ...stops]
    .filter(Boolean).map((p) => `${p!.latitude},${p!.longitude}`).join('|')
  useEffect(() => {
    const map = liveMap()
    if (!map || viewport.height === 0) return
    const points = route?.points.length
      ? route.points
      : [fields[0].place, ...stops].filter((p): p is Place => !!p)
    if (points.length === 0) {
      if (me) map.moveCamera({ target: { lat: me.latitude, lng: me.longitude }, zoom: 15 })
      return
    }
    if (points.length === 1) {
      map.moveCamera({ target: { lat: points[0].latitude, lng: points[0].longitude }, zoom: 16 })
      return
    }
    const lats = points.map((p) => p.latitude)
    const lngs = points.map((p) => p.longitude)
    const north = Math.max(...lats), south = Math.min(...lats)
    const east  = Math.max(...lngs), west  = Math.min(...lngs)
    const top    = insets.top + 8 + cardH + 16
    const bottom = footerH + 16
    map.moveCamera({
      target:  { lat: (north + south) / 2, lng: (east + west) / 2 },
      zoom:    fitZoom({ north, south, east, west }, {
        width:  Math.max(viewport.width - 64, 1),
        height: Math.max(viewport.height - top - bottom, 1),
      }),
      tilt:    0,
      bearing: 0,
    })
    // Re-frame on new places or a new route, not on every layout tweak.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady, placesKey, route, viewport.height, me == null])

  // ── UI ────────────────────────────────────────────────────────────────────

  const destCount   = fields.length - 1
  const activeQuery = active != null ? fields[active]?.text.trim() ?? '' : ''
  // While the start is being edited, offer to go back to the driver's position.
  const showStartOption = active === 0 && fields[0].text.length > 0
  const suggestTop  = insets.top + 8 + cardH + 8
  const missingStart = !fields[0].place && !me && stops.length > 0 && !locating

  return (
    <View
      style={s.root}
      onLayout={(e) => setViewport({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height })}
    >
      <StatusBar barStyle="light-content" backgroundColor="transparent" translucent />

      <MapView
        minZoomLevel={PH_MIN_ZOOM}
        style={StyleSheet.absoluteFill}
        mapColorScheme={MapColorScheme.DARK}
        myLocationEnabled={canShowMe}
        myLocationButtonEnabled={false}
        mapToolbarEnabled={false}
        initialCameraPosition={pin
          ? { target: { lat: pin.latitude, lng: pin.longitude }, zoom: 16 }
          : { target: DEFAULT_CENTER, zoom: 11 }}
        onMapClick={() => { Keyboard.dismiss(); setActive(null); stopSearch() }}
        onMapReady={() => setMapReady(true)}
        onMapViewControllerCreated={(c) => { controller.current = c }}
      />

      {/* Header: back + start and destinations */}
      <View style={[s.header, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity
          onPress={onBack}
          activeOpacity={0.75}
          accessibilityRole="button"
          accessibilityLabel="Back"
          style={s.backBtn}
        >
          <ChevronLeft size={20} color={C.white} strokeWidth={2} />
        </TouchableOpacity>

        <View style={s.card} onLayout={(e) => setCardH(e.nativeEvent.layout.height)}>
          {fields.map((f, i) => {
            const isStart  = i === 0
            const focused  = active === i
            const label    = isStart ? 'Start' : `Destination ${i}`
            const canClear = isStart ? f.text.length > 0 : (f.text.length > 0 || i >= 2)
            return (
              <View key={f.key} style={[s.row, i > 0 && s.rowDivider]}>
                <View style={[s.badge, isStart ? s.badgeStart : s.badgeDest]}>
                  {isStart
                    ? <LocateFixed size={12} color={C.cyan} />
                    : <Text style={s.badgeText}>{i}</Text>}
                </View>
                <TextInput
                  ref={(r) => { inputs.current[f.key] = r }}
                  value={f.text}
                  onChangeText={(t) => onChangeText(i, t)}
                  placeholder={isStart ? 'Current location' : 'Search a destination'}
                  // The empty start reads as the driver's position, so it is not faint.
                  placeholderTextColor={isStart ? C.cyan : C.faint}
                  style={s.input}
                  returnKeyType="search"
                  autoCorrect={false}
                  selectTextOnFocus
                  onFocus={() => { setActive(i); setSuggestions([]); setNoResults(false) }}
                  // Not focused: show the start of a long address, not its end.
                  selection={focused ? undefined : { start: 0, end: 0 }}
                  accessibilityLabel={label}
                />
                {focused && searching ? (
                  <ActivityIndicator size="small" color={C.cyan} />
                ) : canClear ? (
                  <Pressable
                    onPress={() => clearField(i)}
                    hitSlop={10}
                    accessibilityRole="button"
                    accessibilityLabel={i >= 2 ? `Remove ${label}` : `Clear ${label}`}
                  >
                    <X size={16} color={C.faint} />
                  </Pressable>
                ) : null}
              </View>
            )
          })}

          {destCount < MAX_DESTINATIONS && (
            <TouchableOpacity
              onPress={addDestination}
              activeOpacity={0.7}
              style={[s.row, s.rowDivider, s.addRow]}
              accessibilityRole="button"
              accessibilityLabel="Add destination"
            >
              <Plus size={14} color={C.cyan} />
              <Text style={s.addText}>Add destination ({destCount} of {MAX_DESTINATIONS})</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Under the card, not in the footer: the keyboard covers the footer
          while the driver is typing, which is exactly when these matter. */}
      {active != null && (showStartOption || suggestions.length > 0) ? (
        <View style={[s.suggestions, { top: suggestTop }]}>
          {showStartOption && (
            <TouchableOpacity
              onPress={useCurrentLocationAsStart}
              activeOpacity={0.6}
              style={s.suggestion}
              accessibilityRole="button"
              accessibilityLabel="Use current location as the start"
            >
              <LocateFixed size={18} color={C.cyan} />
              <View style={s.suggestionText}>
                <Text style={s.suggestionPrimary}>Current location</Text>
                <Text style={s.suggestionSecondary}>Start from where you are</Text>
              </View>
            </TouchableOpacity>
          )}
          {suggestions.slice(0, 6).map((item, i) => (
            // Plain TouchableOpacity with static styles: a Pressable style
            // function is dropped on device (NativeWind) and breaks the layout.
            <TouchableOpacity
              key={item.placeId}
              onPress={() => void pick(item)}
              activeOpacity={0.6}
              style={[s.suggestion, (i > 0 || showStartOption) && s.suggestionDivider]}
              accessibilityRole="button"
              accessibilityLabel={item.secondary ? `${item.primary}, ${item.secondary}` : item.primary}
            >
              <MapPin size={18} color={C.cyan} />
              <View style={s.suggestionText}>
                <Text style={s.suggestionPrimary} numberOfLines={1}>{item.primary}</Text>
                {!!item.secondary && (
                  <Text style={s.suggestionSecondary} numberOfLines={1}>{item.secondary}</Text>
                )}
              </View>
            </TouchableOpacity>
          ))}
        </View>
      ) : (notice || (noResults && !searching && activeQuery.length >= MIN_QUERY)) ? (
        <View style={[s.suggestions, s.status, { top: suggestTop }]}>
          <Text style={notice ? s.statusError : s.statusText}>
            {notice ?? 'No places found. Try another name or address.'}
          </Text>
        </View>
      ) : null}

      {/* Footer: the route summary and Current location */}
      <View
        style={[s.footer, { paddingBottom: insets.bottom + 16 }]}
        pointerEvents="box-none"
        onLayout={(e) => setFooterH(e.nativeEvent.layout.height)}
      >
        <TouchableOpacity
          onPress={() => void goToCurrentLocation()}
          disabled={locating}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityLabel="Current location"
          style={s.locateBtn}
        >
          {locating
            ? <ActivityIndicator size="small" color={C.cyan} />
            : <LocateFixed size={16} color={C.cyan} />}
          <Text style={s.locateText}>Current location</Text>
        </TouchableOpacity>

        {missingStart ? (
          <View style={s.summary}>
            <Text style={s.summaryNote}>
              Your location isn't available. Tap Current location, or type a start.
            </Text>
          </View>
        ) : routing ? (
          <View style={[s.summary, s.summaryRow]}>
            <ActivityIndicator size="small" color={C.cyan} />
            <Text style={s.summaryNote}>Finding the route…</Text>
          </View>
        ) : routeError ? (
          <View style={s.summary}>
            <Text style={s.summaryError}>{routeError}</Text>
          </View>
        ) : route ? (
          <View style={s.summary}>
            <Text style={s.summaryTotal}>
              {formatLeg(route.seconds)} · {formatDistance(route.meters)}
            </Text>
            {stops.map((p, i) => (
              <View key={`${p.latitude},${p.longitude},${i}`} style={s.legRow}>
                <View style={[s.badge, s.badgeDest]}>
                  <Text style={s.badgeText}>{i + 1}</Text>
                </View>
                <Text style={s.legAddress} numberOfLines={1}>{p.address}</Text>
                {route.legs[i] != null && <Text style={s.legTime}>{formatLeg(route.legs[i])}</Text>}
              </View>
            ))}
          </View>
        ) : null}
      </View>
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
    alignItems:        'flex-start',
    gap:               10,
    paddingHorizontal: 16,
    paddingBottom:     8,
  },
  backBtn: {
    width:           40,
    height:          40,
    borderRadius:    20,
    backgroundColor: C.card,
    borderWidth:     0.5,
    borderColor:     C.line,
    alignItems:      'center',
    justifyContent:  'center',
    marginTop:       2,
  },
  card: {
    flex:            1,
    borderRadius:    14,
    backgroundColor: C.card,
    borderWidth:     1,
    borderColor:     C.cyan,
    overflow:        'hidden',
  },
  row: {
    height:            44,
    flexDirection:     'row',
    alignItems:        'center',
    gap:               10,
    paddingHorizontal: 12,
  },
  rowDivider: {
    borderTopWidth: 0.5,
    borderTopColor: C.line,
  },
  badge: {
    width:          22,
    height:         22,
    borderRadius:   11,
    alignItems:     'center',
    justifyContent: 'center',
  },
  badgeStart: { backgroundColor: C.cyanDim },
  badgeDest:  { backgroundColor: C.cyan },
  badgeText: {
    color:      C.bg,
    fontSize:   11,
    fontWeight: '700',
  },
  input: {
    flex:            1,
    color:           C.white,
    fontSize:        14,
    fontFamily:      FONTS.spartan.medium,
    paddingVertical: 0,
  },
  addRow:  { gap: 8 },
  addText: {
    color:      C.cyan,
    fontSize:   13,
    fontWeight: '700',
  },

  suggestions: {
    position:        'absolute',
    left:            16,
    right:           16,
    borderRadius:    16,
    backgroundColor: C.card,
    borderWidth:     0.5,
    borderColor:     C.line,
    overflow:        'hidden',
  },
  suggestion: {
    flexDirection:     'row',
    alignItems:        'center',
    gap:               14,
    paddingHorizontal: 18,
    paddingVertical:   14,
  },
  suggestionDivider: {
    borderTopWidth: 0.5,
    borderTopColor: C.line,
  },
  status:      { paddingHorizontal: 18, paddingVertical: 14 },
  statusText:  { color: C.faint, fontSize: 13 },
  statusError: { color: C.error, fontSize: 13 },
  suggestionText:    { flex: 1 },
  suggestionPrimary: {
    color:    C.white,
    fontSize: 13,
  },
  suggestionSecondary: {
    color:     C.faint,
    fontSize:  12,
    marginTop: 2,
  },

  footer: {
    position:          'absolute',
    left:              0,
    right:             0,
    bottom:            0,
    paddingHorizontal: 16,
    gap:               10,
    alignItems:        'flex-end',
  },
  summary: {
    alignSelf:         'stretch',
    gap:               8,
    paddingHorizontal: 16,
    paddingVertical:   14,
    borderRadius:      16,
    backgroundColor:   C.card,
    borderWidth:       0.5,
    borderColor:       C.line,
  },
  summaryRow:   { flexDirection: 'row', alignItems: 'center', gap: 10 },
  summaryTotal: { color: C.white, fontSize: 16, fontWeight: '700' },
  summaryNote:  { color: C.faint, fontSize: 13 },
  summaryError: { color: C.error, fontSize: 13 },
  legRow: {
    flexDirection: 'row',
    alignItems:    'center',
    gap:           10,
  },
  legAddress: { flex: 1, color: C.white, fontSize: 13 },
  legTime:    { color: C.cyan, fontSize: 13, fontWeight: '700' },
  locateBtn: {
    flexDirection:     'row',
    alignItems:        'center',
    gap:               8,
    height:            42,
    paddingHorizontal: 16,
    borderRadius:      21,
    backgroundColor:   C.card,
    borderWidth:       1,
    borderColor:       C.cyan,
  },
  locateText: {
    color:      C.cyan,
    fontSize:   13,
    fontWeight: '700',
  },
})
