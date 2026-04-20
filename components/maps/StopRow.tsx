import React from 'react'
import { Text, View } from 'react-native'
import { CheckCircle2, AlertCircle, Navigation2 } from 'lucide-react-native'
import { C } from '../../theme/navigation.theme'
import type { Stop } from '../../types/navigation.types'

interface StopRowProps {
  stop:      Stop
  isOrigin?: boolean
  isLast?:   boolean
  isCurrent?: boolean
}

export function StopRow({ stop, isOrigin, isLast, isCurrent }: StopRowProps) {
  const delivered = stop.status === 'delivered'
  const failed    = stop.status === 'failed'

  const dotColor =
    isOrigin  ? C.cyan :
    delivered ? C.green :
    failed    ? C.red :
    isCurrent ? C.orange : C.dimmer

  const dotBg = delivered ? C.green : failed ? C.red : 'transparent'

  const statusLabel =
    delivered ? 'Delivered' :
    failed    ? 'Failed' :
    isCurrent ? 'Next stop' : 'Pending'

  const statusColor =
    delivered ? C.green :
    failed    ? C.red :
    isCurrent ? C.orange : C.dimWhite

  return (
    <View style={{ flexDirection: 'row', gap: 12, minHeight: 56 }}>
      {/* Timeline column */}
      <View style={{ alignItems: 'center', width: 32, flexShrink: 0 }}>
        <View
          style={{
            width: 28, height: 28, borderRadius: 14,
            borderWidth: 2, borderColor: dotColor,
            backgroundColor: dotBg,
            alignItems: 'center', justifyContent: 'center', flexShrink: 0,
          }}
        >
          {delivered  && <CheckCircle2 size={10} color="#000" />}
          {failed     && <AlertCircle  size={10} color="#fff" />}
          {!delivered && !failed && isOrigin && (
            <Navigation2 size={10} color={C.cyan} />
          )}
          {!delivered && !failed && !isOrigin && (
            <Text style={{ fontSize: 11, fontWeight: '900', color: dotColor }}>
              {stop.optimized_sequence_order}
            </Text>
          )}
        </View>

        {!isLast && (
          <View
            style={{
              flex: 1, width: 2,
              borderLeftWidth: 1, borderStyle: 'dashed',
              borderColor: delivered ? C.green : C.border,
              marginVertical: 2, minHeight: 20,
            }}
          />
        )}
      </View>

      <View style={{ flex: 1, paddingTop: 4, paddingBottom: 12 }}>
        <Text
          style={{
            fontSize: 14, fontWeight: '600', lineHeight: 20,
            color: isCurrent ? C.orange : C.white,
          }}
          numberOfLines={2}
        >
          {stop.address}
        </Text>

        {isOrigin ? (
          <Text style={{ fontSize: 11, marginTop: 2, color: C.dimWhite }}>
            Origin · Pickup
          </Text>
        ) : (
          <Text style={{ fontSize: 11, marginTop: 2, color: statusColor }}>
            {statusLabel}
          </Text>
        )}

        {stop.notes ? (
          <Text style={{ fontSize: 11, marginTop: 2, color: C.dimmer, fontStyle: 'italic' }}>
            {stop.notes}
          </Text>
        ) : null}
      </View>
    </View>
  )
}