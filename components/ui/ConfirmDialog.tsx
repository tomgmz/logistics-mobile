import React from 'react'
import { ActivityIndicator, Modal, Pressable, Text, TouchableOpacity, View } from 'react-native'

import { FONTS } from '../../lib/config/fonts'

/**
 * The small confirmation card the driver gets before anything irreversible:
 * "MARK THIS DELIVERY AS DONE?" and "YOU HAVE RETURNED?".
 *
 * Both are the same shape in the design — a titled card with a line of context
 * and two buttons, Back on the left and the action on the right, tinted by what
 * it does. They differ only in copy and accent, so they are one component rather
 * than two near-identical ones that drift apart the first time the card's
 * padding changes.
 *
 * The tap target is deliberately NOT the whole backdrop: these close a booking
 * and release a vehicle, and a stray tap on a phone in a truck cab should not be
 * able to dismiss the question — let alone answer it.
 */

const D = {
  card:    '#0e1010',
  line:    '#424242',
  white:   '#ffffff',
  faint:   '#818181',
  overlay: 'rgba(0,0,0,0.72)',
}

export type ConfirmTone = 'cyan' | 'green' | 'violet' | 'red'

const TONE: Record<ConfirmTone, { fg: string; bg: string }> = {
  cyan:   { fg: '#4df9ed', bg: 'rgba(77,249,237,0.19)' },
  green:  { fg: '#3af626', bg: 'rgba(58,246,38,0.19)'  },
  violet: { fg: '#8a38f5', bg: 'rgba(138,56,245,0.19)' },
  red:    { fg: '#f62626', bg: 'rgba(246,38,38,0.19)'  },
}

interface Props {
  visible: boolean
  /** Shown in the accent colour, in caps, as in the design. */
  title:   string
  /** One or two short lines of context. */
  message: string
  /** Label of the confirming button — "Done", "Arrived". */
  confirmLabel: string
  cancelLabel?: string
  tone?:    ConfirmTone
  /** Disables both buttons and spins the confirm one. */
  busy?:    boolean
  onConfirm: () => void
  onCancel:  () => void
}

export function ConfirmDialog({
  visible, title, message, confirmLabel, cancelLabel = 'Back',
  tone = 'cyan', busy = false, onConfirm, onCancel,
}: Props) {
  const t = TONE[tone]

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={{
        flex: 1, backgroundColor: D.overlay,
        alignItems: 'center', justifyContent: 'center', padding: 20,
      }}>
        <Pressable
          // Swallows taps that land on the card without doing anything, so the
          // backdrop press below can't fire through it.
          onPress={() => {}}
          style={{
            width: '100%', maxWidth: 340,
            backgroundColor: D.card,
            borderWidth: 0.5, borderColor: D.line,
            borderRadius: 15, padding: 16, gap: 10,
          }}
        >
          <Text style={{
            color: t.fg, fontSize: 15, letterSpacing: 0.3,
            fontFamily: FONTS.spartan.bold,
          }}>
            {title.toUpperCase()}
          </Text>

          <Text style={{
            color: D.white, fontSize: 14, lineHeight: 19,
            fontFamily: FONTS.spartan.medium,
          }}>
            {message}
          </Text>

          <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 4 }}>
            <TouchableOpacity
              onPress={onCancel}
              disabled={busy}
              activeOpacity={0.75}
              accessibilityRole="button"
              style={{
                minWidth: 78, paddingVertical: 9, paddingHorizontal: 18,
                borderRadius: 10, borderWidth: 1, borderColor: D.line,
                alignItems: 'center', opacity: busy ? 0.5 : 1,
              }}
            >
              <Text style={{ color: D.faint, fontSize: 14, fontFamily: FONTS.spartan.bold }}>
                {cancelLabel}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={onConfirm}
              disabled={busy}
              activeOpacity={0.85}
              accessibilityRole="button"
              style={{
                minWidth: 78, paddingVertical: 9, paddingHorizontal: 18,
                borderRadius: 10, borderWidth: 1, borderColor: t.fg,
                backgroundColor: t.bg, alignItems: 'center',
              }}
            >
              {busy
                ? <ActivityIndicator size="small" color={t.fg} />
                : (
                  <Text style={{ color: t.fg, fontSize: 14, fontFamily: FONTS.spartan.bold }}>
                    {confirmLabel}
                  </Text>
                )}
            </TouchableOpacity>
          </View>
        </Pressable>
      </View>
    </Modal>
  )
}
