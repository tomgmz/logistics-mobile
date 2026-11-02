import React from 'react'
import { Text, View, type ViewStyle } from 'react-native'
import { Clock } from 'lucide-react-native'

import { C } from '../../../theme/navigation.theme'
import { formatDuration } from '../../../lib/duration'

/**
 * "Running late" while the server has the delivery flagged delayed: the next
 * stop is 15+ min past its planned window (delay.scheduler). Read-only, like
 * the paused banner: the office and the client are already told, the driver
 * only needs to know. A paused delivery shows the pause instead.
 */

interface DelayFields {
  status?:            string | null
  paused_at?:         string | null
  delayed_since?:     string | null
  delay_minutes?:     number | null
  delay_expected_at?: string | null
}

export function isDelayedNow(booking: unknown): boolean {
  const b = (booking ?? {}) as DelayFields
  return String(b.status ?? '').toLowerCase() === 'in_transit' && !!b.delayed_since && !b.paused_at
}

function timeLabel(iso: string): string {
  const t = new Date(iso)
  return isNaN(t.getTime()) ? '' : t.toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' })
}

export function DelayedBanner({ booking, style }: { booking: unknown; style?: ViewStyle }) {
  if (!isDelayedNow(booking)) return null
  const b        = booking as DelayFields
  const expected = b.delay_expected_at ? timeLabel(b.delay_expected_at) : ''

  return (
    <View
      style={[{
        flexDirection: 'row', alignItems: 'center', gap: 10,
        paddingVertical: 10, paddingHorizontal: 12, borderRadius: 14,
        backgroundColor: C.offlineBg, borderWidth: 1, borderColor: C.offlineBorder,
      }, style]}
    >
      <Clock size={20} color={C.orange} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ color: C.orange, fontSize: 13, fontWeight: '800' }} numberOfLines={1}>
          Running late{b.delay_minutes ? ` · about ${formatDuration(b.delay_minutes)}` : ''}
        </Text>
        <Text style={{ color: C.dimWhite, fontSize: 12, lineHeight: 17 }} numberOfLines={2}>
          {expected ? `Now expected around ${expected} at the next stop.` : 'The next stop is past its planned arrival.'}
        </Text>
        <Text style={{ color: C.dimmer, fontSize: 11 }}>
          The office and the client have been told. Drive safely.
        </Text>
      </View>
    </View>
  )
}
