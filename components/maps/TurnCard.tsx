import React from 'react'
import { Text, TouchableOpacity, View } from 'react-native'
import { MotiView, AnimatePresence } from 'moti'
import {
  ArrowLeft, ChevronDown, ChevronUp, WifiOff, RotateCw,
} from 'lucide-react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { ManeuverIcon } from './ManueverIcon'
import { C } from '../../theme/navigation.theme'
import type { RouteStep } from '../../types/navigation.types'

interface TurnCardProps {
  instruction:    RouteStep
  currentStep:    number
  totalSteps:     number
  onStepBack:     () => void
  onStepForward:  () => void
  onBack:         () => void
  showOffline:    boolean
  isOffline:      boolean
  usingCache:     boolean
  isRerouting:    boolean
}

export function TurnCard({
  instruction,
  currentStep,
  totalSteps,
  onStepBack,
  onStepForward,
  onBack,
  showOffline,
  isOffline,
  usingCache,
  isRerouting,
}: TurnCardProps) {
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
        {(showOffline || isRerouting) && (
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
              backgroundColor: isRerouting ? C.rerouteBg : C.offlineBg,
              borderWidth:     1,
              borderColor:     isRerouting ? C.rerouteBorder : C.offlineBorder,
            }}
          >
            {isRerouting ? (
              <>
                <RotateCw size={10} color={C.cyan} />
                <Text style={{ fontSize: 11, fontWeight: '700', color: C.cyan, letterSpacing: 0.3 }}>
                  Recalculating route…
                </Text>
              </>
            ) : (
              <>
                <WifiOff size={10} color={C.orange} />
                <Text style={{ fontSize: 11, fontWeight: '600', color: C.orange }}>
                  {isOffline
                    ? usingCache ? 'Offline — cached route' : 'No internet'
                    : 'Cached route · reconnecting…'}
                </Text>
              </>
            )}
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
            {instruction.distance || '—'}
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
            {instruction.instruction || 'Continue on current road'}
          </Text>
          {instruction.duration ? (
            <Text style={{ fontSize: 11, color: C.dimWhite, marginTop: 2 }}>
              {instruction.duration} away
            </Text>
          ) : null}
        </View>

        <View style={{ alignItems: 'center', gap: 6, flexShrink: 0 }}>
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
            }}
          >
            <ManeuverIcon key={instruction.maneuver} maneuver={instruction.maneuver} />
          </View>

          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
            <TouchableOpacity
              onPress={onStepBack}
              disabled={currentStep === 0}
              style={{ padding: 3, opacity: currentStep === 0 ? 0.2 : 1 }}
              hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
            >
              <ChevronUp size={12} color={C.cyan} />
            </TouchableOpacity>
            <Text style={{
              fontSize: 10, fontWeight: '600',
              color: C.dimWhite, minWidth: 30, textAlign: 'center',
            }}>
              {currentStep + 1}/{totalSteps}
            </Text>
            <TouchableOpacity
              onPress={onStepForward}
              disabled={currentStep === totalSteps - 1}
              style={{ padding: 3, opacity: currentStep === totalSteps - 1 ? 0.2 : 1 }}
              hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
            >
              <ChevronDown size={12} color={C.cyan} />
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </MotiView>
  )
}