import React from 'react'
import { Text, TouchableOpacity, View } from 'react-native'
import { MotiView, AnimatePresence } from 'moti'
import { ArrowLeft, RotateCw } from 'lucide-react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { ManeuverIcon } from '../shared/ManueverIcon'
import { C } from '../../../theme/navigation.theme'
import { fmtDistance } from '../../../utils/geo'

/**
 * Turn card for the Google Navigation path. Visually identical to the Mapbox
 * TurnCard, but fed by the Google Navigation SDK's turn-by-turn callbacks
 * instead of our own route stepping. Google still owns routing, snapping,
 * voice, rerouting and the rest of its default nav chrome — this only replaces
 * Google's own instruction banner.
 */

interface Props {
  instruction?:   string
  stepDistanceM?: number
  isRerouting?:   boolean
  onBack:         () => void
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

export function GoogleTurnCard({ instruction, stepDistanceM, isRerouting, onBack }: Props) {
  const insets = useSafeAreaInsets()

  return (
    <MotiView
      from={{ opacity: 0, translateY: -80, scale: 0.95 }}
      animate={{ opacity: 1, translateY: 0, scale: 1 }}
      exit={{ opacity: 0, translateY: -80, scale: 0.95 }}
      transition={{ type: 'spring', damping: 20, stiffness: 220 }}
      style={{
        position: 'absolute',
        top:      insets.top + 10,
        left:     12,
        right:    12,
        zIndex:   20,
      }}
    >
      <AnimatePresence>
        {isRerouting && (
          <MotiView
            from={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 30 }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ type: 'timing', duration: 200 }}
            style={{
              flexDirection:   'row',
              alignItems:      'center',
              justifyContent:  'center',
              gap:             6,
              marginBottom:    6,
              borderRadius:    10,
              overflow:        'hidden',
              backgroundColor: C.rerouteBg,
              borderWidth:     1,
              borderColor:     C.rerouteBorder,
            }}
          >
            <RotateCw size={10} color={C.cyan} />
            <Text style={{ fontSize: 11, fontWeight: '700', color: C.cyan, letterSpacing: 0.3 }}>
              Recalculating route…
            </Text>
          </MotiView>
        )}
      </AnimatePresence>

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
          shadowOpacity:   0.6,
          shadowRadius:    20,
          elevation:       20,
        }}
      >
        <TouchableOpacity
          onPress={onBack}
          style={{
            width:           36,
            height:          36,
            borderRadius:    18,
            alignItems:      'center',
            justifyContent:  'center',
            backgroundColor: 'rgba(255,255,255,0.06)',
            flexShrink:      0,
          }}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <ArrowLeft size={17} color={C.white} />
        </TouchableOpacity>

        <View style={{ flex: 1, minWidth: 0 }}>
          <Text
            style={{
              fontSize:      30,
              fontWeight:    '900',
              letterSpacing: -0.8,
              lineHeight:    32,
              color:         C.cyan,
            }}
            numberOfLines={1}
          >
            {stepDistanceM != null && stepDistanceM > 0 ? fmtDistance(stepDistanceM / 1000) : '—'}
          </Text>
          <Text
            style={{
              fontSize:   14,
              fontWeight: '600',
              lineHeight: 19,
              marginTop:  3,
              color:      C.white,
              opacity:    0.85,
            }}
            numberOfLines={2}
          >
            {instruction || 'Continue on current road'}
          </Text>
        </View>

        <View
          style={{
            width:           64,
            height:          64,
            borderRadius:    16,
            alignItems:      'center',
            justifyContent:  'center',
            backgroundColor: 'rgba(0,229,255,0.08)',
            borderWidth:     1.5,
            borderColor:     'rgba(0,229,255,0.25)',
            flexShrink:      0,
          }}
        >
          <ManeuverIcon key={instruction} maneuver={maneuverKeyword(instruction ?? '')} />
        </View>
      </View>
    </MotiView>
  )
}
