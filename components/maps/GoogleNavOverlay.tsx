import React from 'react'
import { Text, TouchableOpacity, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { ArrowLeft, Navigation2 } from 'lucide-react-native'

import { C } from '../../theme/navigation.theme'
import { fmtDistance, fmtDuration } from '../../utils/geo'

/**
 * Custom navigation overlay rendered on top of NavigationView when the SDK's
 * built-in chrome is disabled (navigationUIEnabledPreference=DISABLED).
 *
 * Google still owns routing/snapping/rerouting/voice + the camera; this is just
 * our on-screen UI, fed by the SDK's turn-by-turn callbacks.
 */

interface Props {
  instruction?:   string
  stepDistanceM?: number
  etaSeconds?:    number
  destDistanceM?: number
  rerouting?:     boolean
  current?:       number
  total?:         number
  onBack:         () => void
}

export default function GoogleNavOverlay({
  instruction,
  stepDistanceM,
  etaSeconds,
  destDistanceM,
  rerouting,
  current,
  total,
  onBack,
}: Props) {
  const insets = useSafeAreaInsets()

  return (
    <>
      {/* Back button */}
      <TouchableOpacity
        onPress={onBack}
        style={{
          position: 'absolute', top: insets.top + 12, left: 16, zIndex: 30,
          width: 44, height: 44, borderRadius: 22,
          alignItems: 'center', justifyContent: 'center',
          backgroundColor: C.overlay, borderWidth: 1, borderColor: C.cyanGlow,
        }}
      >
        <ArrowLeft size={20} color={C.cyan} />
      </TouchableOpacity>

      {/* Turn card */}
      {!!(instruction || rerouting) && (
        <View
          style={{
            position: 'absolute', top: insets.top + 12, left: 72, right: 16, zIndex: 25,
            flexDirection: 'row', alignItems: 'center', gap: 12,
            paddingVertical: 12, paddingHorizontal: 14, borderRadius: 16,
            backgroundColor: C.overlay, borderWidth: 1, borderColor: C.border,
          }}
        >
          <View style={{
            width: 40, height: 40, borderRadius: 12,
            alignItems: 'center', justifyContent: 'center', backgroundColor: C.cyanDim,
          }}>
            <Navigation2 size={20} color={C.cyan} />
          </View>
          <View style={{ flex: 1 }}>
            {!rerouting && stepDistanceM != null && stepDistanceM > 0 && (
              <Text style={{ color: C.cyan, fontSize: 13, fontWeight: '800' }}>
                {fmtDistance(stepDistanceM / 1000)}
              </Text>
            )}
            <Text numberOfLines={2} style={{ color: C.white, fontSize: 14, fontWeight: '600' }}>
              {rerouting ? 'Rerouting…' : instruction}
            </Text>
          </View>
        </View>
      )}

      {/* Bottom ETA bar */}
      <View
        style={{
          position: 'absolute', bottom: insets.bottom + 16, left: 16, right: 16, zIndex: 25,
          flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
          paddingVertical: 14, paddingHorizontal: 18, borderRadius: 18,
          backgroundColor: C.overlay, borderWidth: 1, borderColor: C.border,
        }}
      >
        <View>
          <Text style={{ color: C.white, fontSize: 18, fontWeight: '900' }}>
            {etaSeconds ? fmtDuration(etaSeconds / 60) : '—'}
          </Text>
          <Text style={{ color: C.dimWhite, fontSize: 12 }}>
            {destDistanceM ? fmtDistance(destDistanceM / 1000) : ''}
            {total ? `  ·  Stop ${Math.min(current ?? 1, total)} of ${total}` : ''}
          </Text>
        </View>
        <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: C.green }} />
      </View>
    </>
  )
}
