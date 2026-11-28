import React, { useEffect, useState } from 'react'
import { Modal, Pressable, ScrollView, Text, TouchableOpacity, View } from 'react-native'

import { FONTS } from '../../lib/config/fonts'
import { closeAppAlert, subscribeAppAlert, type AppAlert } from '../../lib/appAlert'

/**
 * Draws lib/appAlert's pop-ups in the Figma card (same look as ConfirmDialog:
 * "MARK THIS DELIVERY AS DONE?" / "YOU HAVE RETURNED?"): the title in caps in
 * the accent colour, the message in white, buttons on the right — cancel ones
 * outlined grey, the action tinted (red when destructive, cyan otherwise).
 * Mounted once, in the root layout.
 */

const D = {
  card:    '#0e1010',
  line:    '#424242',
  white:   '#ffffff',
  faint:   '#818181',
  overlay: 'rgba(0,0,0,0.72)',
  cyan:    { fg: '#4df9ed', bg: 'rgba(77,249,237,0.19)' },
  red:     { fg: '#f62626', bg: 'rgba(246,38,38,0.19)'  },
}

export function AppAlertHost() {
  const [alert, setAlert] = useState<AppAlert | null>(null)
  useEffect(() => subscribeAppAlert(setAlert), [])

  if (!alert) return null

  const cancelable = !!alert.options?.cancelable
  const dismiss = () => {
    if (!cancelable) return
    closeAppAlert(alert.id, alert.options?.onDismiss)
  }
  // Red only when every action is destructive ("Delete?"); a choice between a
  // red and a normal answer keeps the cyan title.
  const actions = alert.buttons.filter((b) => b.style !== 'cancel')
  const accent  = actions.length > 0 && actions.every((b) => b.style === 'destructive') ? D.red : D.cyan
  // Three or more buttons don't fit one row on a 320 px phone: stacked, action first.
  const stacked = alert.buttons.length > 2

  return (
    <Modal visible transparent animationType="fade" statusBarTranslucent onRequestClose={dismiss}>
      <Pressable
        onPress={dismiss}
        accessibilityElementsHidden
        style={{ flex: 1, backgroundColor: D.overlay, alignItems: 'center', justifyContent: 'center', padding: 20 }}
      >
        <Pressable
          // Taps on the card itself never reach the backdrop.
          onPress={() => {}}
          accessibilityRole="alert"
          style={{
            width: '100%', maxWidth: 340, maxHeight: '85%',
            backgroundColor: D.card,
            borderWidth: 0.5, borderColor: D.line,
            borderRadius: 15, padding: 16, gap: 10,
          }}
        >
          <Text style={{ color: accent.fg, fontSize: 15, letterSpacing: 0.3, fontFamily: FONTS.spartan.bold }}>
            {alert.title.toUpperCase()}
          </Text>

          {alert.message ? (
            <ScrollView style={{ flexGrow: 0 }} showsVerticalScrollIndicator={false}>
              <Text style={{ color: D.white, fontSize: 14, lineHeight: 19, fontFamily: FONTS.spartan.medium }}>
                {alert.message}
              </Text>
            </ScrollView>
          ) : null}

          <View style={{
            flexDirection: stacked ? 'column-reverse' : 'row',
            justifyContent: 'flex-end',
            gap: 10,
            marginTop: 4,
          }}>
            {alert.buttons.map((b, i) => {
              const isCancel = b.style === 'cancel'
              const tone     = b.style === 'destructive' ? D.red : D.cyan
              return (
                <TouchableOpacity
                  key={`${b.text ?? 'OK'}-${i}`}
                  onPress={() => closeAppAlert(alert.id, b.onPress ? () => b.onPress!() : undefined)}
                  activeOpacity={0.8}
                  accessibilityRole="button"
                  style={{
                    minWidth: 78, paddingVertical: 9, paddingHorizontal: 18,
                    borderRadius: 10, borderWidth: 1,
                    borderColor:     isCancel ? D.line : tone.fg,
                    backgroundColor: isCancel ? 'transparent' : tone.bg,
                    alignItems: 'center',
                  }}
                >
                  <Text style={{
                    color: isCancel ? D.faint : tone.fg,
                    fontSize: 14, textAlign: 'center',
                    fontFamily: FONTS.spartan.bold,
                  }}>
                    {b.text ?? 'OK'}
                  </Text>
                </TouchableOpacity>
              )
            })}
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  )
}
