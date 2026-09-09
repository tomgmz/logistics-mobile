import React from 'react'
import { Modal, Pressable, Text, TouchableOpacity, View } from 'react-native'
import { X } from 'lucide-react-native'

import { FONTS } from '../../lib/config/fonts'

/**
 * "REPORT A CASE" — the fork between the two ways of raising something.
 *
 * It exists because the two are not variations of one form, they are different
 * decisions made under different amounts of pressure, and asking the driver
 * which one they are in is faster than making them find out by scrolling. The
 * quick alert is one tap away from here; the detailed form is a screen.
 *
 * Opened from the reports list's floating button and from the SOS control on the
 * navigation map, so the same fork is reachable whether the driver is parked or
 * mid-route.
 */

const D = {
  sheet:   '#0a0a0a',
  card:    '#0e1010',
  line:    '#424242',
  white:   '#ffffff',
  faint:   '#818181',
  cyan:    '#4df9ed',
  red:     '#f62626',
  overlay: 'rgba(0,0,0,0.72)',
}

interface Props {
  visible: boolean
  /** Booking reference and date, shown so the driver can see what it will be filed against. */
  contextRef?:  string | null
  contextDate?: string | null
  onQuickAlert: () => void
  onDetailed:   () => void
  onClose:      () => void
}

export function ReportOptionModal({
  visible, contextRef, contextDate, onQuickAlert, onDetailed, onClose,
}: Props) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable
        onPress={onClose}
        style={{
          flex: 1, backgroundColor: D.overlay,
          alignItems: 'center', justifyContent: 'center', padding: 20,
        }}
      >
        <Pressable
          onPress={() => {}}
          style={{
            width: '100%', maxWidth: 340,
            backgroundColor: D.sheet,
            borderWidth: 0.5, borderColor: D.line,
            borderRadius: 15, padding: 16, gap: 14,
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: D.white, fontSize: 20, fontFamily: FONTS.spartan.bold }}>
                REPORT A CASE
              </Text>
              {(contextRef || contextDate) && (
                <Text style={{ color: D.faint, fontSize: 12, marginTop: 2, fontFamily: FONTS.spartan.medium }}>
                  {contextRef ? <Text style={{ color: D.cyan }}>for {contextRef}</Text> : null}
                  {contextRef && contextDate ? '  ·  ' : ''}
                  {contextDate ?? ''}
                </Text>
              )}
            </View>
            <TouchableOpacity
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="Close"
              hitSlop={10}
            >
              <X size={20} color={D.faint} />
            </TouchableOpacity>
          </View>

          <View style={{ flexDirection: 'row', gap: 12 }}>
            <TouchableOpacity
              onPress={onQuickAlert}
              activeOpacity={0.85}
              accessibilityRole="button"
              accessibilityLabel="Quick alert — sends an emergency signal immediately"
              style={{
                flex: 1, minHeight: 132,
                alignItems: 'center', justifyContent: 'center',
                gap: 8, paddingHorizontal: 10,
                borderRadius: 12, borderWidth: 0.5, borderColor: D.line,
                backgroundColor: D.card,
              }}
            >
              <Text style={{
                color: D.red, fontSize: 22, lineHeight: 24, textAlign: 'center',
                fontFamily: FONTS.spartan.bold,
              }}>
                QUICK{'\n'}ALERT
              </Text>
              <Text style={{
                color: D.faint, fontSize: 11, lineHeight: 15, textAlign: 'center',
                fontFamily: FONTS.spartan.medium,
              }}>
                sends an emergency signal immediately
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={onDetailed}
              activeOpacity={0.85}
              accessibilityRole="button"
              accessibilityLabel="Report with details — opens the full emergency report form"
              style={{
                flex: 1, minHeight: 132,
                alignItems: 'center', justifyContent: 'center',
                gap: 8, paddingHorizontal: 10,
                borderRadius: 12, borderWidth: 0.5, borderColor: D.line,
                backgroundColor: D.card,
              }}
            >
              <Text style={{
                color: D.white, fontSize: 22, lineHeight: 24, textAlign: 'center',
                fontFamily: FONTS.spartan.bold,
              }}>
                REPORT{'\n'}WITH{'\n'}DETAILS
              </Text>
              <Text style={{
                color: D.red, fontSize: 11, lineHeight: 15, textAlign: 'center',
                fontFamily: FONTS.spartan.medium,
              }}>
                opens a detailed emergency report form
              </Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  )
}
