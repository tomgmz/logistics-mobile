import React, { useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { MotiView, AnimatePresence } from 'moti'
import { ArrowLeft, ChevronDown, RotateCw } from 'lucide-react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { ManeuverIcon } from '../shared/ManueverIcon'
import { fmtDistance } from '../../../utils/geo'
import { FONTS } from '../../../lib/config/fonts'

/**
 * The chrome that sits on top of the Google Navigation map — back control, the
 * current leg's from → to header, and the turn card.
 *
 * Built from the Figma "Tracking [in transit]" frame (node 2872:834). Google
 * still owns the map itself: routing, the route line, snapping, camera-follow,
 * voice and rerouting. Nothing here touches that; this only replaces Google's
 * own instruction banner, which the screen hides.
 */

const D = {
  chrome:      '#424242',
  chromeLine:  'rgba(255,255,255,0.7)',
  card:        '#003632',
  cyan:        '#4df9ed',
  white:       '#ffffff',
  faint:       '#818181',
  pickup:      '#ffea00',
  dropoff:     '#ff7a30',
}

export interface TurnStep {
  instruction: string
  distanceM:   number
}

interface Props {
  instruction?:   string
  stepDistanceM?: number
  /** Every manoeuvre still ahead, from the SDK's `getRemainingSteps`. */
  steps?:         TurnStep[]
  isRerouting?:   boolean
  onBack:         () => void
  /** Where the current leg starts — the stop just completed, if any. */
  fromLabel?:     string | null
  fromAddress?:   string | null
  /** Where the current leg ends — the stop being driven to. */
  toLabel?:       string | null
  toAddress?:     string | null
}

// Derive a ManeuverIcon keyword from the instruction text (the SDK's numeric
// maneuver enum isn't exposed as named constants).
function maneuverKeyword(instruction: string): string {
  const s = instruction.toLowerCase()
  if (s.includes('u-turn') || s.includes('u turn')) return 'uturn'
  if (s.includes('roundabout') || s.includes('rotary')) return 'roundabout'
  if (s.includes('slight left'))  return 'slight-left'
  if (s.includes('slight right')) return 'slight-right'
  if (s.includes('merge'))        return 'merge'
  if (s.includes('ramp') || s.includes('exit')) return 'ramp'
  if (s.includes('destination') || s.includes('arrive')) return 'destination'
  if (s.includes('left'))  return 'turn-left'
  if (s.includes('right')) return 'turn-right'
  return 'straight'
}

export function GoogleTurnCard({
  instruction,
  stepDistanceM,
  steps,
  isRerouting,
  onBack,
  fromLabel,
  fromAddress,
  toLabel,
  toAddress,
}: Props) {
  const insets = useSafeAreaInsets()
  const [open, setOpen] = useState(false)

  // The SDK's remaining-steps list normally leads with the manoeuvre already on
  // the card, so drop it rather than showing the same turn twice.
  const upcoming = (steps ?? []).slice(
    steps?.[0]?.instruction === instruction ? 1 : 0,
  )
  const canExpand = upcoming.length > 0

  return (
    <MotiView
      from={{ opacity: 0, translateY: -80 }}
      animate={{ opacity: 1, translateY: 0 }}
      exit={{ opacity: 0, translateY: -80 }}
      transition={{ type: 'spring', damping: 20, stiffness: 220 }}
      style={[s.root, { top: insets.top + 7 }]}
      pointerEvents="box-none"
    >
      {/* Back + the leg this drive is covering */}
      <View style={s.topRow} pointerEvents="box-none">
        <TouchableOpacity
          onPress={onBack}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityLabel="Leave navigation"
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          style={s.backBtn}
        >
          <ArrowLeft size={20} color={D.white} strokeWidth={2} />
        </TouchableOpacity>

        {(fromAddress || toAddress) && (
          <View style={s.legPill}>
            <View style={s.legCol}>
              <Text style={[s.legLabel, { color: D.pickup }]} numberOfLines={1}>
                {fromLabel ?? 'From'}
              </Text>
              <Text style={s.legValue} numberOfLines={1}>{fromAddress ?? '—'}</Text>
            </View>

            <View style={[s.legCol, s.legColRight]}>
              <Text style={[s.legLabel, { color: D.dropoff }]} numberOfLines={1}>
                {toLabel ?? 'To'}
              </Text>
              <Text style={s.legValue} numberOfLines={1}>{toAddress ?? '—'}</Text>
            </View>
          </View>
        )}
      </View>

      <AnimatePresence>
        {isRerouting && (
          <MotiView
            from={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 28 }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ type: 'timing', duration: 200 }}
            style={s.reroute}
          >
            <RotateCw size={11} color={D.cyan} />
            <Text style={s.rerouteText}>Recalculating route…</Text>
          </MotiView>
        )}
      </AnimatePresence>

      {/* Turn card — taps open the rest of the manoeuvres beneath it */}
      <View style={s.turnCard}>
        <Pressable
          onPress={() => canExpand && setOpen((o) => !o)}
          disabled={!canExpand}
          accessibilityRole="button"
          accessibilityLabel={
            canExpand
              ? (open ? 'Hide the remaining directions' : 'Show the remaining directions')
              : undefined
          }
          style={s.turnRow}
        >
          <View style={s.maneuver}>
            <ManeuverIcon
              key={instruction}
              maneuver={maneuverKeyword(instruction ?? '')}
              size={24}
              color={D.white}
            />
          </View>

          <View style={s.turnText}>
            <Text style={s.turnDistance} numberOfLines={1}>
              {stepDistanceM != null && stepDistanceM > 0 ? fmtDistance(stepDistanceM / 1000) : '—'}
            </Text>
            <Text style={s.turnInstruction} numberOfLines={1}>
              {instruction || 'Continue on current road'}
            </Text>
          </View>

          {canExpand && (
            <ChevronDown
              size={16}
              color={D.cyan}
              style={{ transform: [{ rotate: open ? '180deg' : '0deg' }] }}
            />
          )}
        </Pressable>

        {open && canExpand && (
          <ScrollView
            style={s.stepList}
            contentContainerStyle={{ paddingBottom: 6 }}
            showsVerticalScrollIndicator={false}
            nestedScrollEnabled
          >
            {upcoming.map((step, i) => (
              <View key={`${i}-${step.instruction}`} style={s.stepRow}>
                <View style={s.maneuver}>
                  <ManeuverIcon
                    maneuver={maneuverKeyword(step.instruction)}
                    size={20}
                    color={D.white}
                  />
                </View>
                <View style={s.turnText}>
                  <Text style={s.turnDistance} numberOfLines={1}>
                    {step.distanceM > 0 ? fmtDistance(step.distanceM / 1000) : ''}
                  </Text>
                  <Text style={s.stepInstruction} numberOfLines={2}>
                    {step.instruction}
                  </Text>
                </View>
              </View>
            ))}
          </ScrollView>
        )}
      </View>
    </MotiView>
  )
}

const s = StyleSheet.create({
  root: {
    position: 'absolute',
    left:     22,
    right:    22,
    // Above the round map controls (21/25) and the banners (22/24): expanded,
    // the step list runs down over them and has to cover them, not sit behind.
    // Android needs the elevation on the card itself to agree, since elevation
    // — not zIndex — decides overlap there.
    zIndex:   40,
  },

  topRow: {
    flexDirection: 'row',
    alignItems:    'center',
    gap:           6,
  },
  backBtn: {
    width:           40,
    height:          40,
    borderRadius:    20,
    backgroundColor: D.chrome,
    borderWidth:     2,
    borderColor:     D.white,
    alignItems:      'center',
    justifyContent:  'center',
    flexShrink:      0,
  },
  legPill: {
    flex:              1,
    height:            40,
    flexDirection:     'row',
    alignItems:        'center',
    gap:               10,
    paddingHorizontal: 8,
    paddingVertical:   6,
    borderRadius:      15,
    backgroundColor:   D.chrome,
    borderWidth:       2,
    borderColor:       D.chromeLine,
    shadowColor:       '#000',
    shadowOffset:      { width: 0, height: 4 },
    shadowOpacity:     0.25,
    shadowRadius:      4,
    elevation:         6,
  },
  legCol: {
    flex:      1,
    minWidth:  0,
  },
  legColRight: {
    alignItems: 'flex-end',
  },
  legLabel: {
    fontSize:   8,
    fontWeight: '700',
  },
  legValue: {
    color:    D.white,
    fontSize: 13,
  },

  reroute: {
    flexDirection:   'row',
    alignItems:      'center',
    justifyContent:  'center',
    gap:             6,
    marginTop:       6,
    borderRadius:    10,
    overflow:        'hidden',
    backgroundColor: D.card,
    borderWidth:     1,
    borderColor:     D.cyan,
  },
  rerouteText: {
    fontSize:      11,
    fontWeight:    '700',
    color:         D.cyan,
    letterSpacing: 0.3,
  },

  turnCard: {
    marginTop:         6,
    overflow:          'hidden',
    paddingHorizontal: 15,
    borderRadius:      15,
    backgroundColor:   D.card,
    borderWidth:       2,
    borderColor:       D.cyan,
    shadowColor:       '#000',
    shadowOffset:      { width: 0, height: 4 },
    shadowOpacity:     0.25,
    shadowRadius:      4,
    // Above the round map controls' elevation of 8, so the expanded step list
    // covers them on Android rather than being drawn under them.
    elevation:         14,
  },
  turnRow: {
    minHeight:      45,
    flexDirection:  'row',
    alignItems:     'center',
    gap:            15,
    paddingVertical: 6,
  },
  /** The remaining manoeuvres, capped so the card never swallows the map. */
  stepList: {
    maxHeight:      190,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(77,249,237,0.35)',
  },
  stepRow: {
    flexDirection:   'row',
    alignItems:      'center',
    gap:             15,
    paddingVertical: 8,
  },
  stepInstruction: {
    color:     D.white,
    fontSize:  13,
    marginTop: 1,
    opacity:   0.9,
  },
  maneuver: {
    width:          24,
    height:         24,
    alignItems:     'center',
    justifyContent: 'center',
    flexShrink:     0,
  },
  turnText: {
    flex:     1,
    minWidth: 0,
  },
  turnDistance: {
    color:    D.faint,
    fontSize: 9,
  },
  turnInstruction: {
    color:      D.white,
    fontSize:   14,
    marginTop:  1,
    fontFamily: FONTS.spartan.medium,
  },
})
