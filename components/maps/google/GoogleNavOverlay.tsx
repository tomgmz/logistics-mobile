import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Animated, Text, TouchableOpacity, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { AnimatePresence, MotiView } from 'moti'
import { ArrowLeft, PackageCheck, RotateCw } from 'lucide-react-native'

import { ManeuverIcon } from '../shared/ManueverIcon'
import { BottomSheet } from '../shared/BottomSheet'
import { C } from '../../../theme/navigation.theme'
import { fmtDistance, fmtDuration } from '../../../utils/geo'
import type { BookingRoute, Stop } from '../../../types/navigation.types'

/**
 * Full custom navigation overlay for the Google path — mirrors the Mapbox UI
 * (turn card + bottom sheet with stop list + trip-complete) but is fed by the
 * Google Navigation SDK's turn-by-turn callbacks and your booking data.
 *
 * Google still owns the map, route line, camera-follow, voice and rerouting.
 */

interface Props {
  instruction?:   string
  stepDistanceM?: number
  etaSeconds?:    number      // to final destination
  destDistanceM?: number      // to final destination
  rerouting?:     boolean
  origin?:        { latitude: number; longitude: number; address: string } | null
  stops:          Stop[]
  tripComplete?:  boolean
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

export default function GoogleNavOverlay({
  instruction,
  stepDistanceM,
  etaSeconds,
  destDistanceM,
  rerouting,
  origin,
  stops,
  tripComplete,
  onBack,
}: Props) {
  const insets = useSafeAreaInsets()

  const [sheetOpen, setSheetOpen] = useState(false)
  const sheetAnim = useRef(new Animated.Value(0)).current

  useEffect(() => {
    Animated.spring(sheetAnim, {
      toValue: sheetOpen ? 1 : 0,
      useNativeDriver: false,
      tension: 80,
      friction: 12,
    }).start()
  }, [sheetOpen, sheetAnim])

  const completedCount = useMemo(
    () => stops.filter((s) => s.status === 'delivered').length,
    [stops],
  )
  const nextStop = useMemo(() => stops.find((s) => s.status === 'pending'), [stops])

  const routeData: BookingRoute = useMemo(() => ({
    origin: origin ?? { latitude: 0, longitude: 0, address: 'Pickup' },
    stops,
    total_duration: etaSeconds ? etaSeconds / 60 : 0,
    total_distance: destDistanceM ? destDistanceM / 1000 : 0,
    polyline: [],
    trafficSegments: [],
    steps: [],
  }), [origin, stops, etaSeconds, destDistanceM])

  const stopListData: Stop[] = useMemo(() => {
    const list: Stop[] = []
    if (origin) {
      list.push({
        destination_id: '__origin__',
        address: origin.address,
        latitude: origin.latitude,
        longitude: origin.longitude,
        optimized_sequence_order: 0,
        status: 'delivered',
      })
    }
    return [...list, ...stops]
  }, [origin, stops])

  // ── Trip complete ──
  if (tripComplete) {
    return (
      <View
        style={{
          position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center',
          paddingHorizontal: 32, paddingTop: insets.top, paddingBottom: insets.bottom + 16,
        }}
      >
        <View style={{
          width: 96, height: 96, borderRadius: 48,
          backgroundColor: C.greenDim, borderWidth: 2, borderColor: C.green,
          alignItems: 'center', justifyContent: 'center', marginBottom: 24,
        }}>
          <PackageCheck size={44} color={C.green} />
        </View>
        <Text style={{ fontSize: 28, fontWeight: '900', color: C.white, textAlign: 'center' }}>
          Trip Complete
        </Text>
        <Text style={{ fontSize: 14, color: C.dimWhite, textAlign: 'center', marginTop: 8 }}>
          All {stops.length} stop{stops.length !== 1 ? 's' : ''} delivered
        </Text>
        <TouchableOpacity
          onPress={onBack}
          activeOpacity={0.85}
          style={{
            width: '100%', marginTop: 40, paddingVertical: 16, borderRadius: 16,
            backgroundColor: C.cyan, alignItems: 'center',
          }}
        >
          <Text style={{ color: '#000', fontSize: 15, fontWeight: '800' }}>Done</Text>
        </TouchableOpacity>
      </View>
    )
  }

  return (
    <>
      {/* ── Turn card ── */}
      <View style={{ position: 'absolute', top: insets.top + 10, left: 12, right: 12, zIndex: 20 }}>
        <AnimatePresence>
          {rerouting && (
            <MotiView
              from={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 30 }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ type: 'timing', duration: 200 }}
              style={{
                flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
                marginBottom: 6, borderRadius: 10, overflow: 'hidden',
                backgroundColor: C.rerouteBg, borderWidth: 1, borderColor: C.rerouteBorder,
              }}
            >
              <RotateCw size={10} color={C.cyan} />
              <Text style={{ fontSize: 11, fontWeight: '700', color: C.cyan }}>Recalculating route…</Text>
            </MotiView>
          )}
        </AnimatePresence>

        <View
          style={{
            flexDirection: 'row', alignItems: 'center', gap: 12,
            paddingVertical: 14, paddingLeft: 14, paddingRight: 12, borderRadius: 20,
            backgroundColor: C.bannerBg, borderWidth: 1, borderColor: C.bannerBorder,
            shadowColor: '#000', shadowOffset: { width: 0, height: 8 },
            shadowOpacity: 0.6, shadowRadius: 20, elevation: 20,
          }}
        >
          <TouchableOpacity
            onPress={onBack}
            style={{
              width: 36, height: 36, borderRadius: 18, alignItems: 'center',
              justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.06)', flexShrink: 0,
            }}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <ArrowLeft size={17} color={C.white} />
          </TouchableOpacity>

          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={{ fontSize: 30, fontWeight: '900', letterSpacing: -0.8, lineHeight: 32, color: C.cyan }} numberOfLines={1}>
              {stepDistanceM != null && stepDistanceM > 0 ? fmtDistance(stepDistanceM / 1000) : '—'}
            </Text>
            <Text style={{ fontSize: 14, fontWeight: '600', lineHeight: 19, marginTop: 3, color: C.white, opacity: 0.85 }} numberOfLines={2}>
              {instruction || 'Continue on current road'}
            </Text>
          </View>

          <View style={{
            width: 64, height: 64, borderRadius: 16, alignItems: 'center', justifyContent: 'center',
            backgroundColor: 'rgba(0,229,255,0.08)', borderWidth: 1.5, borderColor: 'rgba(0,229,255,0.25)', flexShrink: 0,
          }}>
            <ManeuverIcon maneuver={maneuverKeyword(instruction ?? '')} />
          </View>
        </View>
      </View>

      {/* ── Bottom sheet (ETA / total / done, progress, next stop, stop list) ── */}
      <BottomSheet
        routeData={routeData}
        nextStop={nextStop}
        completedCount={completedCount}
        sheetOpen={sheetOpen}
        sheetAnim={sheetAnim}
        stopListData={stopListData}
        onToggle={() => setSheetOpen((o) => !o)}
      />
    </>
  )
}
