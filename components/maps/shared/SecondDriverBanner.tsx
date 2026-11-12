import React from 'react'
import { Text, View, type ViewStyle } from 'react-native'
import { UserCheck } from 'lucide-react-native'

import { C } from '../../../theme/navigation.theme'

/**
 * On the navigation map after the office swapped the drivers (2026-11-13): this
 * driver is now the second driver, so the stop buttons are blocked and the main
 * driver confirms the pickup, stops and proof photos. Guidance keeps running so
 * the driver can still follow the route. Read-only, like the paused banner.
 */
export function SecondDriverBanner({ leadName, style }: { leadName: string; style?: ViewStyle }) {
  return (
    <View
      style={[{
        flexDirection: 'row', alignItems: 'center', gap: 10,
        paddingVertical: 10, paddingHorizontal: 12, borderRadius: 14,
        backgroundColor: 'rgba(10,10,10,0.92)', borderWidth: 1, borderColor: C.cyanGlow,
      }, style]}
    >
      <UserCheck size={20} color={C.cyan} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ color: C.cyan, fontSize: 13, fontWeight: '800' }} numberOfLines={1}>
          You are now the second driver
        </Text>
        <Text style={{ color: C.dimWhite, fontSize: 12, lineHeight: 17 }} numberOfLines={2}>
          {`${leadName || 'The main driver'} confirms the stops and proof photos.`}
        </Text>
      </View>
    </View>
  )
}
