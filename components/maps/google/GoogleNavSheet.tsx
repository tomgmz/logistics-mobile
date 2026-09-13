import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
  Animated,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import Svg, { ClipPath, Defs, G, Path, Rect } from 'react-native-svg'
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
 * Closed it is the banner and its ETA strip and nothing else, the banner's own
 * 31px. The map is what a driver needs while moving; the route board is for
 * when they have stopped to check it.
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
 * The banner's own coordinate space, straight from the SVG. It is stretched to
 * the screen's width (preserveAspectRatio="none"), so the tab keeps its 31px
 * height while its width stays the same fraction of the panel it is in Figma.
 */
const HEADER_VB_W = 584
const HEADER_H    = 31
/** Height of the flat bar the tab hangs off. */
const HEADER_BAR_H = 9
/**
 * The tab's flat middle, between the two curved shoulders. Content wider than
 * this runs into the slope, so the ETA strip is capped to it.
 */
const HEADER_TAB_FLAT = (431 - 152) / HEADER_VB_W

/**
 * The peek is the banner header and nothing more — the shape is
 * DetailsPanelContentHeader.svg, the same one the web client's transit-tracking
 * panel uses (components/map/DetailsPanelContent): a thin bar across the top
 * with a tab dipping out of its middle. The tab carries the ETA strip and the
 * bar is left clean, so the closed sheet is exactly the banner's own 31px and
 * the map keeps everything below it. The banner's own shape is the drag
 * affordance — it needs no handle drawn on top of it.
 *
 * The web copy inlines the file rather than loading it, and so does this one:
 * the paths need to be tinted and stretched, which an <Image> can't do.
 */
export const SHEET_PEEK_H = HEADER_H

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
  /**
   * Fires with the height the panel is heading for, whenever that changes — on
   * mount, on a drag or tap, and when the resting heights themselves move. The
   * navigation screen feeds it to the SDK's mapPadding so Google draws its own
   * re-center button above the panel instead of behind it.
   *
   * Reported at the start of the spring, not the end: the button should be on
   * its way up while the panel is still opening.
   */
  onRestingHeight?: (height: number, expanded: boolean) => void
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
  onRestingHeight,
}: Props) {
  const insets = useSafeAreaInsets()
  const { height: screenH, width: sheetW } = useWindowDimensions()

  const [expanded, setExpanded] = useState(false)

  const peekH = SHEET_PEEK_H + insets.bottom
  const openH = Math.min(screenH * 0.6, 480) + insets.bottom

  const height = useRef(new Animated.Value(peekH)).current

  /**
   * Springs the panel to one of its two resting heights and records which one
   * it settled on. Height can't run on the native driver.
   */
  const settle = (open: boolean, velocity = 0) => {
    setExpanded(open)
    onRestingHeight?.(open ? openH : peekH, open)
    Animated.spring(height, {
      toValue: open ? openH : peekH,
      velocity,
      useNativeDriver: false,
      damping:   25,
      stiffness: 200,
    }).start()
  }

  // Keeps the panel honest when the resting heights themselves move — a rotation,
  // or the safe-area inset arriving a frame late. It deliberately doesn't watch
  // `expanded`: every change to that comes through `settle`, which is already
  // mid-spring by the time this would run, and re-springing here would throw
  // away the velocity a flick handed it.
  const expandedRef = useRef(expanded)
  expandedRef.current = expanded

  useEffect(() => {
    const target = expandedRef.current ? openH : peekH
    onRestingHeight?.(target, expandedRef.current)
    Animated.spring(height, {
      toValue: target,
      useNativeDriver: false,
      damping:   25,
      stiffness: 200,
    }).start()
    // `onRestingHeight` is the caller's, and re-running this on every render of
    // theirs would restart the spring.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openH, peekH, height])

  /**
   * Dragging the banner slides the panel between the peek and the open height,
   * following the finger the whole way; letting go snaps to whichever end the
   * gesture was heading for. A drag that never really moved is a tap, and taps
   * still toggle — a driver reaching for this at a stop shouldn't have to drag.
   *
   * The gesture lives on the banner rather than the whole panel so that the
   * route board underneath keeps its own scrolling.
   */
  const dragStartH = useRef(peekH)
  const pan = useMemo(
    () => PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      // Claim the gesture only once it's a real vertical drag, so a tap still
      // reads as a tap.
      onMoveShouldSetPanResponder: (_e, g) =>
        Math.abs(g.dy) > 3 && Math.abs(g.dy) > Math.abs(g.dx),

      onPanResponderGrant: () => {
        height.stopAnimation((current: number) => { dragStartH.current = current })
      },

      onPanResponderMove: (_e, g) => {
        // Up is negative dy, and up makes the panel taller.
        const next = Math.min(Math.max(dragStartH.current - g.dy, peekH), openH)
        height.setValue(next)
      },

      onPanResponderRelease: (_e, g) => {
        const travelled = Math.abs(g.dy)

        if (travelled < 4) {                 // a tap
          settle(!expanded)
          return
        }

        // A decisive flick wins outright; otherwise the panel goes wherever it
        // is already closest to.
        if (Math.abs(g.vy) > 0.5) {
          settle(g.vy < 0)
          return
        }

        const current = Math.min(Math.max(dragStartH.current - g.dy, peekH), openH)
        settle(current > (peekH + openH) / 2, -g.vy)
      },

      // Something upstream took the gesture — put the panel back where it was.
      onPanResponderTerminate: () => settle(expanded),
    }),
    // `settle` closes over the current heights and `expanded`, so the responder
    // has to be rebuilt when those change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [expanded, openH, peekH, height],
  )

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
    <>
      {/*
        Touching the map puts the panel away.

        The map is the native view underneath everything here, so there is no
        touch of its own to listen for — this is a transparent catcher laid over
        it while the panel is open, sitting above the map but below every
        control (the turn card, the disc column, the panel itself all carry a
        higher zIndex), so only a touch that would have landed on bare map
        reaches it. That touch is spent collapsing rather than passed on to the
        map, which is the usual bargain for dismiss-on-touch-outside and the
        reason this exists only while the panel is open.
      */}
      {expanded && (
        <Pressable
          style={s.scrim}
          onPress={() => settle(false)}
          accessible={false}
          importantForAccessibility="no"
        />
      )}

    <Animated.View style={[s.sheet, { height }]}>
      {/* The peek. Tapping anywhere on it opens or closes the panel. */}
      <View
        {...pan.panHandlers}
        accessibilityRole="adjustable"
        accessibilityLabel="Trip details"
        accessibilityValue={{ text: expanded ? 'Expanded' : 'Collapsed' }}
        accessibilityHint="Drag or tap to show or hide the route"
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={(e) => settle(e.nativeEvent.actionName === 'increment')}
        // The peek takes the safe-area strip with it. Sized to the banner alone,
        // the leftover inset belonged to the body below, which then showed a
        // sliver of the route board under the banner whenever the panel was
        // closed.
        style={[s.peek, { height: SHEET_PEEK_H + insets.bottom }]}
      >
        {/* DetailsPanelContentHeader.svg, inlined — see SHEET_PEEK_H above. */}
        <Svg
          style={s.banner}
          width="100%"
          height={HEADER_H}
          viewBox={`0 0 ${HEADER_VB_W} ${HEADER_H}`}
          preserveAspectRatio="none"
        >
          <Rect width={HEADER_VB_W} height={HEADER_BAR_H} fill={D.handle} />
          <G clipPath="url(#navSheetHeaderClip)">
            <Path
              d="M116.177 8.00001C98.1978 7.99999 292.198 8.00001 292.198 8.00001V31C292.198 31 174.749 31 152.723 31C130.697 31 134.156 8.00003 116.177 8.00001Z"
              fill={D.handle}
            />
            <Path
              d="M468.021 8.00001C486 7.99999 292 8.00001 292 8.00001V31C292 31 409.449 31 431.474 31C453.5 31 450.042 8.00003 468.021 8.00001Z"
              fill={D.handle}
            />
          </G>
          <Defs>
            <ClipPath id="navSheetHeaderClip">
              <Rect x={115} width={354} height={HEADER_H} fill="#fff" />
            </ClipPath>
          </Defs>
        </Svg>

        {/* ETA strip, centred in the tab that hangs below it. */}
        <View style={s.etaStrip}>
          <View style={[s.etaInner, { maxWidth: sheetW * HEADER_TAB_FLAT }]}>
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
              size={13}
              color={D.faint}
              style={{ transform: [{ rotate: expanded ? '180deg' : '0deg' }] }}
            />
          </View>
        </View>
      </View>

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
    </>
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
  /** Over the map, under every control — see the catcher above. */
  scrim: {
    position: 'absolute',
    top:      0,
    left:     0,
    right:    0,
    bottom:   0,
    zIndex:   20,
  },

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
    height: SHEET_PEEK_H,
  },
  /** Pinned to the top of the peek: the banner keeps its own height there. */
  banner: {
    position: 'absolute',
    top:      0,
    left:     0,
    right:    0,
    height:   HEADER_H,
  },
  /** The tab: everything below the bar, the full width of the panel. */
  etaStrip: {
    position:       'absolute',
    left:           0,
    right:          0,
    top:            HEADER_BAR_H,
    height:         HEADER_H - HEADER_BAR_H,
    alignItems:     'center',
    justifyContent: 'center',
  },
  etaInner: {
    flexDirection:  'row',
    alignItems:     'center',
    justifyContent: 'center',
    gap:            6,
  },
  etaText: {
    color:    D.cyan,
    fontSize: 11,
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
    // The banner already separates the peek from the body, and a rule here
    // would run straight into the bottom of its tab.
    paddingTop:        10,
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
