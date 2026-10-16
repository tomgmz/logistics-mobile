import React from 'react'
import { Text, TouchableOpacity, View, type ViewStyle } from 'react-native'
import { PauseCircle, Play } from 'lucide-react-native'

import { pauseReasonLabel, type TripPause } from '../../../lib/tripPause'
import { C } from '../../../theme/navigation.theme'

/**
 * "Delivery paused" with the reason, the driver's note and when it started,
 * and the one thing to do about it: Resume. Shown on the navigation map and on
 * the booking screen, so a paused driver can't miss it in either place.
 */

function sinceLabel(iso: string): string {
  const t = new Date(iso)
  return isNaN(t.getTime())
    ? ''
    : t.toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' })
}

export function PausedBanner({
  pause, onResume, style,
}: {
  pause:    TripPause
  /** Omitted for a read-only view (the second driver). */
  onResume?: () => void
  style?:   ViewStyle
}) {
  const since = sinceLabel(pause.pausedAt)

  return (
    <View
      style={[{
        flexDirection: 'row', alignItems: 'center', gap: 10,
        paddingVertical: 10, paddingHorizontal: 12, borderRadius: 14,
        backgroundColor: C.offlineBg, borderWidth: 1, borderColor: C.offlineBorder,
      }, style]}
    >
      <PauseCircle size={20} color={C.orange} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ color: C.orange, fontSize: 13, fontWeight: '800' }} numberOfLines={1}>
          Delivery paused · {pauseReasonLabel(pause.reason)}
        </Text>
        {!!pause.note && (
          <Text style={{ color: C.dimWhite, fontSize: 12, lineHeight: 17 }} numberOfLines={2}>{pause.note}</Text>
        )}
        {!!since && <Text style={{ color: C.dimmer, fontSize: 11 }}>Since {since}</Text>}
      </View>
      {onResume && (
        <TouchableOpacity
          onPress={onResume}
          accessibilityRole="button"
          accessibilityLabel="Resume the delivery"
          style={{
            flexDirection: 'row', alignItems: 'center', gap: 6,
            paddingVertical: 9, paddingHorizontal: 12, borderRadius: 12,
            backgroundColor: C.green,
          }}
        >
          <Play size={14} color="#000" fill="#000" />
          <Text style={{ color: '#000', fontSize: 13, fontWeight: '800' }}>Resume</Text>
        </TouchableOpacity>
      )}
    </View>
  )
}
