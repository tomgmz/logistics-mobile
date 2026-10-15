import React, { useCallback, useEffect, useRef, useState } from 'react'
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
import { ChevronLeft, LocateFixed, MapPin, Search, X } from 'lucide-react-native'
import * as Location from 'expo-location'

import api from '../../../lib/api/auth.api'
import { readCurrentFix } from '../../../lib/stopGeofence'
import { FONTS } from '../../../lib/config/fonts'

/**
 * A plain map the driver can look around on — the home screen's Maps shortcut.
 *
 * Not tied to any booking: no route, no guidance, no confirmations. The driver
 * can pan and zoom, search a place with Google Places autocomplete (the same
 * Philippines-only search as the client booking form's map), and jump back to
 * where they are with "Current location". The active delivery is still reached
 * from its order card and "Check your routes".
 *
 * Search goes through our /places proxy rather than straight to Google, because
 * the app's key is restricted to the native Maps SDK.
 */

interface Props {
  onBack: () => void
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

const C = {
  bg:      '#000000',
  card:    '#0e1010',
  line:    '#424242',
  white:   '#ffffff',
  faint:   '#818181',
  cyan:    '#4df9ed',
  cyanDim: 'rgba(77,249,237,0.19)',
  error:   '#ff4d4d',
}

// Metro Manila, until the driver's own position is known.
const DEFAULT_CENTER = { lat: 14.5995, lng: 120.9842 }
const MIN_QUERY      = 3
const DEBOUNCE_MS    = 300

/** One token per search, so Google bills the typing and the pick as one session. */
function newSessionToken(): string {
  let token = ''
  for (let i = 0; i < 32; i++) token += Math.floor(Math.random() * 16).toString(16)
  return token
}

export default function BrowseMapScreen({ onBack }: Props) {
  const insets = useSafeAreaInsets()

  const controller = useRef<MapViewController | null>(null)
  const session    = useRef(newSessionToken())
  const requestId  = useRef(0)
  const timer      = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastFix    = useRef<{ latitude: number; longitude: number } | null>(null)

  const [query,       setQuery]       = useState('')
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [searching,   setSearching]   = useState(false)
  const [place,       setPlace]       = useState<Place | null>(null)
  const [locating,    setLocating]    = useState(false)
  const [notice,      setNotice]      = useState<string | null>(null)
  const [canShowMe,   setCanShowMe]   = useState(false)

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  // The blue dot needs permission; it is not asked for here, only on "Current location".
  useEffect(() => {
    Location.getForegroundPermissionsAsync()
      .then(({ status }) => setCanShowMe(status === 'granted'))
      .catch(() => {})
  }, [])

  const goToCurrentLocation = useCallback(async (quiet = false) => {
    setLocating(true)
    setNotice(null)
    const fix = await readCurrentFix()
    setLocating(false)
    if (!fix) {
      if (!quiet) setNotice('Could not read your current location.')
      return
    }
    lastFix.current = fix
    setCanShowMe(true)
    controller.current?.moveCamera({ target: { lat: fix.latitude, lng: fix.longitude }, zoom: 15 })
  }, [])

  const onMapReady = useCallback((c: MapViewController) => {
    controller.current = c
    c.moveCamera({ target: DEFAULT_CENTER, zoom: 11 })
    void goToCurrentLocation(true)
  }, [goToCurrentLocation])

  const search = useCallback(async (text: string) => {
    const id = ++requestId.current
    setSearching(true)
    try {
      const { data } = await api.post('/places/autocomplete', {
        input:        text,
        sessionToken: session.current,
        ...(lastFix.current && { near: lastFix.current }),
      })
      if (id !== requestId.current) return
      setSuggestions(data.data ?? [])
      setNotice(null)
    } catch {
      if (id !== requestId.current) return
      setSuggestions([])
      setNotice('Place search is unavailable right now.')
    } finally {
      if (id === requestId.current) setSearching(false)
    }
  }, [])

  const onChangeQuery = (text: string) => {
    setQuery(text)
    if (timer.current) clearTimeout(timer.current)
    if (text.trim().length < MIN_QUERY) {
      requestId.current++
      setSuggestions([])
      setSearching(false)
      return
    }
    timer.current = setTimeout(() => void search(text.trim()), DEBOUNCE_MS)
  }

  const clearSearch = () => {
    requestId.current++
    setQuery('')
    setSuggestions([])
    setSearching(false)
    setPlace(null)
    controller.current?.removeMarker('search')
  }

  const pick = async (s: Suggestion) => {
    Keyboard.dismiss()
    setSuggestions([])
    setQuery(s.primary)
    setSearching(true)
    try {
      const { data } = await api.post('/places/details', {
        placeId:      s.placeId,
        sessionToken: session.current,
      })
      const found: Place = data.data
      setPlace(found)
      setQuery(found.address)
      const map = controller.current
      if (map) {
        map.removeMarker('search')
        void map.addMarker({
          id:       'search',
          position: { lat: found.latitude, lng: found.longitude },
          title:    s.primary,
          snippet:  found.address,
        })
        map.moveCamera({ target: { lat: found.latitude, lng: found.longitude }, zoom: 16 })
      }
    } catch {
      setNotice('Could not open that place. Try another result.')
    } finally {
      setSearching(false)
      // The session ends with a pick; the next search starts a new one.
      session.current = newSessionToken()
    }
  }

  return (
    <View style={s.root}>
      <StatusBar barStyle="light-content" backgroundColor="transparent" translucent />

      <MapView
        style={StyleSheet.absoluteFill}
        mapColorScheme={MapColorScheme.DARK}
        myLocationEnabled={canShowMe}
        myLocationButtonEnabled={false}
        mapToolbarEnabled={false}
        onMapClick={() => Keyboard.dismiss()}
        onMapViewControllerCreated={onMapReady}
      />

      {/* Header: back + search */}
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

        <View style={s.searchBox}>
          <Search size={16} color={C.faint} />
          <TextInput
            value={query}
            onChangeText={onChangeQuery}
            placeholder="Search a place or address"
            placeholderTextColor={C.faint}
            style={s.searchInput}
            returnKeyType="search"
            autoCorrect={false}
            selectTextOnFocus
            accessibilityLabel="Search a place or address"
          />
          {searching ? (
            <ActivityIndicator size="small" color={C.cyan} />
          ) : query.length > 0 ? (
            <Pressable onPress={clearSearch} hitSlop={10} accessibilityRole="button" accessibilityLabel="Clear search">
              <X size={16} color={C.faint} />
            </Pressable>
          ) : null}
        </View>
      </View>

      {suggestions.length > 0 && (
        <View style={[s.suggestions, { top: insets.top + 60 }]}>
          {suggestions.slice(0, 6).map((item, i) => (
            <Pressable
              key={item.placeId}
              onPress={() => void pick(item)}
              style={({ pressed }) => [s.suggestion, i > 0 && s.suggestionDivider, pressed && s.suggestionPressed]}
              accessibilityRole="button"
            >
              <MapPin size={16} color={C.cyan} />
              <View style={s.suggestionText}>
                <Text style={s.suggestionPrimary} numberOfLines={1}>{item.primary}</Text>
                {!!item.secondary && (
                  <Text style={s.suggestionSecondary} numberOfLines={1}>{item.secondary}</Text>
                )}
              </View>
            </Pressable>
          ))}
        </View>
      )}

      {/* Footer: the picked place, any notice, and Current location */}
      <View style={[s.footer, { paddingBottom: insets.bottom + 16 }]} pointerEvents="box-none">
        {!!notice && <Text style={s.notice}>{notice}</Text>}

        {place && (
          <View style={s.placeCard}>
            <MapPin size={16} color={C.cyan} />
            <Text style={s.placeText} numberOfLines={2}>{place.address}</Text>
          </View>
        )}

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
    alignItems:        'center',
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
  },
  searchBox: {
    flex:              1,
    height:            44,
    flexDirection:     'row',
    alignItems:        'center',
    gap:               8,
    paddingHorizontal: 14,
    borderRadius:      12,
    backgroundColor:   C.card,
    borderWidth:       1,
    borderColor:       C.cyan,
  },
  searchInput: {
    flex:       1,
    color:      C.white,
    fontSize:   14,
    fontFamily: FONTS.spartan.medium,
    paddingVertical: 0,
  },

  suggestions: {
    position:        'absolute',
    left:            16,
    right:           16,
    borderRadius:    12,
    backgroundColor: C.card,
    borderWidth:     0.5,
    borderColor:     C.line,
    overflow:        'hidden',
  },
  suggestion: {
    flexDirection:     'row',
    alignItems:        'center',
    gap:               10,
    paddingHorizontal: 14,
    paddingVertical:   12,
  },
  suggestionDivider: {
    borderTopWidth: 0.5,
    borderTopColor: C.line,
  },
  suggestionPressed: { backgroundColor: 'rgba(255,255,255,0.06)' },
  suggestionText:    { flex: 1 },
  suggestionPrimary: {
    color:      C.white,
    fontSize:   14,
    fontFamily: FONTS.spartan.medium,
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
  notice: {
    alignSelf:         'stretch',
    color:             C.error,
    fontSize:          12,
    textAlign:         'center',
    paddingVertical:   8,
    paddingHorizontal: 12,
    borderRadius:      10,
    backgroundColor:   'rgba(0,0,0,0.8)',
    overflow:          'hidden',
  },
  placeCard: {
    alignSelf:         'stretch',
    flexDirection:     'row',
    alignItems:        'center',
    gap:               10,
    paddingHorizontal: 14,
    paddingVertical:   12,
    borderRadius:      12,
    backgroundColor:   C.card,
    borderWidth:       0.5,
    borderColor:       C.line,
  },
  placeText: {
    flex:     1,
    color:    C.white,
    fontSize: 13,
  },
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
