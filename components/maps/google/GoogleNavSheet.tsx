import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
  Animated,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { ChevronUp, Truck, Camera, Check } from 'lucide-react-native'

import { fmtDistance, fmtDuration } from '../../../utils/geo'
import { FONTS } from '../../../lib/config/fonts'

/**
 * The trip panel over the bottom of the navigation map.
 *
 * Built from the Figma "Tracking [in transit]" frame (node 2872:834), and
 * animated the way the web client's route sheet is (components/map/RouteMap):
 * one spring on the panel's height between a small peek and a fraction of the
 * screen, with the body only scrollable once it is open.
 *
 * Closed it is the grab handle and the ETA strip and nothing else — the frame
 * gives that peek 35px. The map is what a driver needs while moving; the route
 * board is for when they have stopped to check it.
 *
 * Google still owns the map itself. This only replaces the SDK's own footer.
 */

const D = {
  sheet:  '#1b1b1b',
  handle: '#424242',
  line:   '#424242',
  white:  '#ffffff',
  faint:  '#818181',
  cyan:   '#4df9ed',
  green:  '#3af626',
  track:  '#3a3a3a',
}

/**
 * The peek: grab handle + ETA strip, nothing more.
 *
 * This is what decides how low the closed sheet sits — the panel is pinned to
 * the bottom edge, so a shorter peek puts its rounded top further down and hands
 * the map back more of the screen. The floor is roughly 40: below that the
 * handle and the 13px ETA row start to crowd each other.
 */
export const SHEET_PEEK_H = 35

export interface SheetStop {
  kind:    'pickup' | 'dropoff'
  number?: number
  label:   string
  address: string
}

interface Props {
  stops:    SheetStop[]
  /** Index into `stops` of the one being driven to. */
  legIndex: number
  /** Seconds and metres to the stop ahead, from the SDK's turn-by-turn feed. */
  etaSeconds?:      number
  distanceM?:       number
  /** Seconds to the last stop of the run. */
  totalEtaSeconds?: number
  /** Opens the proof popup for a stop — the same one arrival detection opens. */
  onConfirmStop:    (index: number) => void
}

/** "Cabuyao, Laguna City" out of a full address line. */
function locality(address: string): string {
  const parts = address.split(',').map((p) => p.trim()).filter(Boolean)
  return parts.length <= 1 ? '' : parts.slice(1).join(', ')
}

/** The recognisable head of an address — the place, not the whole line. */
function placeName(address: string): string {
  return address.split(',')[0]?.trim() || address
}

export function GoogleNavSheet({
  stops,
  legIndex,
  etaSeconds,
  distanceM,
  totalEtaSeconds,
  onConfirmStop,
}: Props) {
  const insets = useSafeAreaInsets()
  const { height: screenH } = useWindowDimensions()

  const [expanded, setExpanded] = useState(false)

  const peekH = SHEET_PEEK_H + insets.bottom
  const openH = Math.min(screenH * 0.6, 480) + insets.bottom

  const height = useRef(new Animated.Value(peekH)).current

  useEffect(() => {
    Animated.spring(height, {
      toValue: expanded ? openH : peekH,
      // Height can't run on the native driver.
      useNativeDriver: false,
      damping:   25,
      stiffness: 200,
    }).start()
  }, [expanded, openH, peekH, height])

  const from = legIndex > 0 ? stops[legIndex - 1] : null
  const to   = stops[legIndex] ?? null

  const pickup   = useMemo(() => stops.find((s) => s.kind === 'pickup') ?? null, [stops])
  const dropoffs = useMemo(() => stops.filter((s) => s.kind === 'dropoff'), [stops])

  // How far along the run we are, for the truck on the progress line.
  const progress = stops.length > 1
    ? Math.min(Math.max(legIndex / (stops.length - 1), 0), 1)
    : 0

  const arrivalClock = useMemo(() => {
    if (etaSeconds == null || etaSeconds <= 0) return null
    return new Date(Date.now() + etaSeconds * 1000).toLocaleTimeString('en-PH', {
      hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Manila',
    })
  }, [etaSeconds])

  return (
    <Animated.View style={[s.sheet, { height }]}>
      {/* The peek. Tapping anywhere on it opens or closes the panel. */}
      <Pressable
        onPress={() => setExpanded((e) => !e)}
        accessibilityRole="button"
        accessibilityLabel={expanded ? 'Collapse trip details' : 'Expand trip details'}
        style={s.peek}
      >
        <View style={s.handle} />

        <View style={s.etaStrip}>
          <Text style={s.etaText} numberOfLines={1}>
            {etaSeconds != null && etaSeconds > 0 ? fmtDuration(etaSeconds / 60) : '—'}
          </Text>
          <View style={s.etaDot} />
          <Text style={s.etaText} numberOfLines={1}>
            {distanceM != null && distanceM > 0 ? fmtDistance(distanceM / 1000) : '—'}
          </Text>
          <View style={s.etaDot} />
          <Text style={s.etaText} numberOfLines={1}>{arrivalClock ?? '—'}</Text>

          <ChevronUp
            size={15}
            color={D.faint}
            style={{ transform: [{ rotate: expanded ? '180deg' : '0deg' }] }}
          />
        </View>
      </Pressable>

      <ScrollView
        style={s.body}
        contentContainerStyle={[s.bodyContent, { paddingBottom: insets.bottom + 20 }]}
        showsVerticalScrollIndicator={false}
        scrollEnabled={expanded}
        nestedScrollEnabled
      >
        {/* Route header */}
        <View style={s.rowBetween}>
          <Text style={s.sectionTitle}>Route</Text>
          <Text style={s.onTheWay} numberOfLines={1}>
            <Text style={{ color: D.faint }}>ON THE WAY: </Text>
            {totalEtaSeconds != null && totalEtaSeconds > 0 ? fmtDuration(totalEtaSeconds / 60) : '—'}
          </Text>
        </View>

        {/* Current leg, with the truck at the run's progress */}
        <View style={s.legRow}>
          <Text style={s.legEnd} numberOfLines={1}>
            <Text style={{ color: D.cyan }}>FROM </Text>
            {from ? placeName(from.address) : 'Current location'}
          </Text>
          <Text style={[s.legEnd, { textAlign: 'right' }]} numberOfLines={1}>
            <Text style={{ color: D.cyan }}>TO </Text>
            {to ? placeName(to.address) : '—'}
          </Text>
        </View>

        <View style={s.progressWrap}>
          <View style={s.progressTrack} />
          <View style={[s.progressFill, { width: `${progress * 100}%` }]} />
          <View style={[s.truck, { left: `${progress * 100}%` }]}>
            <Truck size={15} color={D.white} />
          </View>
        </View>

        <View style={s.rowBetween}>
          <View style={s.legCol}>
            <Text style={s.placeName} numberOfLines={1}>{from ? placeName(from.address) : '—'}</Text>
            <Text style={s.placeSub}  numberOfLines={1}>{from ? locality(from.address) : ''}</Text>
          </View>
          <View style={[s.legCol, { alignItems: 'flex-end' }]}>
            <Text style={s.placeName} numberOfLines={1}>{to ? placeName(to.address) : '—'}</Text>
            <Text style={s.placeSub}  numberOfLines={1}>{to ? locality(to.address) : ''}</Text>
          </View>
        </View>

        {/* Route board — pickup on the left, drop-offs down the right */}
        <View style={s.boardHeaders}>
          <Text style={s.boardHeader}>Pick Up Point</Text>
          <Text style={s.boardHeader}>Drop Off Point</Text>
        </View>

        <View style={s.board}>
          <View style={s.boardDivider} />

          <View style={s.boardCol}>
            {pickup && (
              <BoardStop
                stop={pickup}
                index={stops.indexOf(pickup)}
                legIndex={legIndex}
                onConfirm={onConfirmStop}
              />
            )}
          </View>

          <View style={s.boardCol}>
            {dropoffs.map((d) => (
              <BoardStop
                key={`${d.label}-${d.address}`}
                stop={d}
                index={stops.indexOf(d)}
                legIndex={legIndex}
                onConfirm={onConfirmStop}
              />
            ))}
          </View>
        </View>
      </ScrollView>
    </Animated.View>
  )
}

/**
 * One stop on the board. Everything before the current leg is done; the current
 * one carries the action that confirms it.
 */
function BoardStop({
  stop, index, legIndex, onConfirm,
}: {
  stop:      SheetStop
  index:     number
  legIndex:  number
  onConfirm: (index: number) => void
}) {
  const done    = index < legIndex
  const current = index === legIndex

  return (
    <View>
      <View style={s.boardStopHead}>
        <View style={[s.marker, done && { borderColor: D.green }, current && { borderColor: D.cyan }]}>
          {done
            ? <Check size={7} color={D.green} strokeWidth={3} />
            : <View style={[s.markerDot, current && { backgroundColor: D.cyan }]} />}
        </View>
        <Text style={s.placeName} numberOfLines={1}>{placeName(stop.address)}</Text>
      </View>

      <Text style={s.boardSub} numberOfLines={1}>{locality(stop.address)}</Text>

      {done ? (
        <Text style={[s.proofLink, s.proofIndent, { color: D.faint }]}>Proof uploaded</Text>
      ) : current ? (
        <TouchableOpacity
          onPress={() => onConfirm(index)}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel={`Upload proof of delivery for ${stop.label}`}
          style={s.proofBtn}
        >
          <Camera size={11} color={D.cyan} />
          <Text style={s.proofLink}>Upload Proof of Delivery</Text>
        </TouchableOpacity>
      ) : (
        <Text style={[s.proofLink, s.proofIndent, { color: D.faint }]}>Upload Proof of Delivery</Text>
      )}
    </View>
  )
}

const s = StyleSheet.create({
  sheet: {
    position:             'absolute',
    left:                 0,
    right:                0,
    bottom:               0,
    zIndex:               30,
    backgroundColor:      D.sheet,
    borderTopLeftRadius:  40,
    borderTopRightRadius: 40,
    overflow:             'hidden',
    shadowColor:          '#000',
    shadowOffset:         { width: 0, height: -6 },
    shadowOpacity:        0.5,
    shadowRadius:         16,
    elevation:            24,
  },

  peek: {
    height:     SHEET_PEEK_H,
    paddingTop: 7,
  },
  handle: {
    alignSelf:       'center',
    width:           96,
    height:          5,
    borderRadius:    3,
    backgroundColor: D.handle,
  },
  etaStrip: {
    flex:              1,
    flexDirection:     'row',
    alignItems:        'center',
    justifyContent:    'center',
    gap:               8,
    paddingHorizontal: 16,
  },
  etaText: {
    color:    D.cyan,
    fontSize: 13,
  },
  etaDot: {
    width:           4,
    height:          4,
    borderRadius:    2,
    backgroundColor: D.cyan,
  },

  body: {
    flex: 1,
  },
  bodyContent: {
    paddingHorizontal: 16,
    paddingTop:        10,
    borderTopWidth:    StyleSheet.hairlineWidth,
    borderTopColor:    D.line,
  },

  rowBetween: {
    flexDirection:  'row',
    alignItems:     'flex-start',
    justifyContent: 'space-between',
    gap:            12,
  },
  sectionTitle: {
    color:      D.white,
    fontSize:   14,
    fontFamily: FONTS.spartan.medium,
  },
  onTheWay: {
    color:      D.white,
    fontSize:   10,
    textAlign:  'right',
    flexShrink: 1,
  },

  legRow: {
    flexDirection:  'row',
    justifyContent: 'space-between',
    gap:            12,
    marginTop:      10,
  },
  legEnd: {
    color:    D.faint,
    fontSize: 10,
    flex:     1,
  },
  legCol: {
    flex:     1,
    minWidth: 0,
  },

  progressWrap: {
    height:         20,
    marginTop:      4,
    marginBottom:   4,
    justifyContent: 'center',
  },
  progressTrack: {
    height:          3,
    borderRadius:    2,
    backgroundColor: D.track,
  },
  progressFill: {
    position:        'absolute',
    height:          3,
    borderRadius:    2,
    backgroundColor: D.cyan,
  },
  truck: {
    position:   'absolute',
    marginLeft: -9,
  },

  placeName: {
    color:      D.white,
    fontSize:   14,
    fontFamily: FONTS.spartan.medium,
    flexShrink: 1,
  },
  placeSub: {
    color:     D.white,
    fontSize:  10,
    marginTop: 1,
    opacity:   0.75,
  },

  boardHeaders: {
    flexDirection: 'row',
    marginTop:     16,
    marginBottom:  8,
  },
  boardHeader: {
    flex:       1,
    color:      D.faint,
    fontSize:   14,
    textAlign:  'center',
    fontFamily: FONTS.spartan.medium,
  },

  board: {
    flexDirection: 'row',
    position:      'relative',
  },
  boardDivider: {
    position:        'absolute',
    left:            '50%',
    top:             0,
    bottom:          0,
    width:           StyleSheet.hairlineWidth,
    backgroundColor: D.line,
  },
  boardCol: {
    flex:              1,
    paddingHorizontal: 8,
    gap:               16,
  },
  boardStopHead: {
    flexDirection: 'row',
    alignItems:    'center',
    gap:           7,
  },
  marker: {
    width:          14,
    height:         14,
    borderRadius:   7,
    borderWidth:    1.5,
    borderColor:    D.faint,
    alignItems:     'center',
    justifyContent: 'center',
    flexShrink:     0,
  },
  markerDot: {
    width:           6,
    height:          6,
    borderRadius:    3,
    backgroundColor: D.faint,
  },
  boardSub: {
    color:      D.white,
    fontSize:   10,
    marginLeft: 21,
    opacity:    0.75,
  },
  proofBtn: {
    flexDirection: 'row',
    alignItems:    'center',
    gap:           4,
    marginLeft:    21,
    marginTop:     2,
  },
  proofLink: {
    color:     D.cyan,
    fontSize:  10,
    fontStyle: 'italic',
  },
  /** Lines up with the text beside the marker when there is no button. */
  proofIndent: {
    marginLeft: 21,
    marginTop:  2,
  },
})
