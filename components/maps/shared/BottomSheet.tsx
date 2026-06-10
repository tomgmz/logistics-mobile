import React from 'react'
import {
  Animated, Dimensions, FlatList, Text, TouchableOpacity, View,
} from 'react-native'
import { 
  Clock, Route, CheckCircle2, ChevronDown, ChevronUp, MapPin,
} from 'lucide-react-native'

import { StopRow } from './StopRow'
import { C } from '../../../theme/navigation.theme'
import { fmtDuration, fmtDistance } from '../../../utils/geo'
import type { BookingRoute, Stop } from '../../../types/navigation.types'

const { height: SH } = Dimensions.get('window')

interface BottomSheetProps {
  routeData:      BookingRoute | null
  nextStop:       Stop | undefined
  completedCount: number
  sheetOpen:      boolean
  sheetAnim:      Animated.Value
  stopListData:   Stop[]
  onToggle:       () => void
}

export function BottomSheet({
  routeData,
  nextStop,
  completedCount,
  sheetOpen,
  sheetAnim,
  stopListData,
  onToggle,
}: BottomSheetProps) {
  const sheetHeight = sheetAnim.interpolate({
    inputRange:  [0, 1],
    outputRange: [184, SH * 0.62],
  })

  const progress =
    routeData && routeData.stops.length > 0
      ? (completedCount / routeData.stops.length) * 100
      : 0

  return (
    <Animated.View
      style={{
        position:        'absolute',
        bottom:          0,
        left:            0,
        right:           0,
        height:          sheetHeight,
        backgroundColor: C.surface,
        borderTopLeftRadius:  28,
        borderTopRightRadius: 28,
        borderTopWidth:       1,
        borderTopColor:       C.border,
        overflow:        'hidden',
      }}
    >
      <TouchableOpacity
        onPress={onToggle}
        activeOpacity={0.8}
        style={{ paddingHorizontal: 16, paddingTop: 10, paddingBottom: 8, flexShrink: 0 }}
      >
        <View
          style={{
            width: 40, height: 4, borderRadius: 2,
            backgroundColor: C.borderHi, alignSelf: 'center', marginBottom: 12,
          }}
        />

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <Chip
            icon={<Clock size={13} color={C.cyan} />}
            value={routeData ? fmtDuration(routeData.total_duration) : '—'}
            label="ETA"
          />
          <Chip
            icon={<Route size={13} color={C.cyan} />}
            value={routeData ? fmtDistance(routeData.total_distance) : '—'}
            label="Total"
          />
          <Chip
            icon={<CheckCircle2 size={13} color={C.green} />}
            value={`${completedCount}/${routeData?.stops.length ?? 0}`}
            label="Done"
            valueColor={C.green}
          />
          <View style={{ paddingLeft: 2 }}>
            {sheetOpen
              ? <ChevronDown size={16} color={C.dimWhite} />
              : <ChevronUp   size={16} color={C.dimWhite} />}
          </View>
        </View>

        {routeData && (
          <View
            style={{
              height: 3, borderRadius: 2, overflow: 'hidden',
              backgroundColor: C.border,
            }}
          >
            <View
              style={{
                height: 3, borderRadius: 2,
                width: `${progress}%`,
                backgroundColor: C.cyan,
              }}
            />
          </View>
        )}
      </TouchableOpacity>

      {nextStop && (
        <View
          style={{
            flexDirection: 'row',
            alignItems:    'center',
            paddingHorizontal: 16,
            paddingVertical:   10,
            borderTopWidth:    1,
            borderTopColor:    C.border,
            gap: 10,
            backgroundColor: C.surfaceMid,
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 0 }}>
            <View
              style={{
                width: 6, height: 6, borderRadius: 3,
                backgroundColor: C.orange,
              }}
            />
            <Text style={{ fontSize: 11, fontWeight: '700', color: C.orange, letterSpacing: 0.5 }}>
              NEXT STOP
            </Text>
          </View>
          <Text style={{ fontSize: 13, flex: 1, color: C.white }} numberOfLines={1}>
            {nextStop.address}
          </Text>
        </View>
      )}

      {sheetOpen && (
        <FlatList
          data={stopListData}
          keyExtractor={(item) => item.destination_id}
          contentContainerStyle={{
            paddingHorizontal: 16, paddingTop: 10, paddingBottom: 40,
          }}
          showsVerticalScrollIndicator={false}
          renderItem={({ item, index }) => (
            <StopRow
              stop={item}
              isOrigin={item.destination_id === '__origin__'}
              isLast={index === stopListData.length - 1}
              isCurrent={item.destination_id === nextStop?.destination_id}
            />
          )}
        />
      )}
    </Animated.View>
  )
}

function Chip({
  icon, value, label, valueColor,
}: {
  icon:        React.ReactNode
  value:       string
  label:       string
  valueColor?: string
}) {
  return (
    <View
      style={{
        flex:            1,
        flexDirection:   'row',
        alignItems:      'center',
        gap:             6,
        borderRadius:    10,
        paddingVertical: 8,
        paddingHorizontal: 10,
        backgroundColor: C.surfaceHi,
        borderWidth:     1,
        borderColor:     C.border,
      }}
    >
      {icon}
      <Text style={{ fontSize: 13, fontWeight: '700', flex: 1, color: valueColor ?? C.white }}>
        {value}
      </Text>
      <Text style={{ fontSize: 10, color: C.dimmer }}>{label}</Text>
    </View>
  )
}