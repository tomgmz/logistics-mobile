import React from 'react'
import { Modal, Pressable, StyleSheet, Text, TouchableOpacity, View } from 'react-native'

/**
 * "Go to Drop-off 3 next?" — the confirmation, and an optional reason the
 * office sees with the change. Skipping the reason still goes; Cancel doesn't.
 * A modal rather than an Alert: Android shows at most three Alert buttons.
 */

export type StopOrderReason = 'client_asked' | 'bay_closed' | 'traffic' | 'nearer_first' | 'other'

const REASONS: Array<{ key: StopOrderReason; label: string }> = [
  { key: 'client_asked', label: 'The client asked' },
  { key: 'bay_closed',   label: 'Bay closed or not ready' },
  { key: 'traffic',      label: 'Traffic or road closed' },
  { key: 'nearer_first', label: 'Nearer stop first' },
  { key: 'other',        label: 'Other' },
]

const D = { bg: '#1b1b1b', line: '#3a3a3a', white: '#ffffff', faint: '#818181', cyan: '#4df9ed' }

export function StopOrderReasonModal({ visible, stopLabel, onPick, onCancel }: {
  visible:   boolean
  stopLabel: string
  /** null = no reason given. */
  onPick:    (reason: StopOrderReason | null) => void
  onCancel:  () => void
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <Pressable style={s.backdrop} onPress={onCancel}>
        <Pressable style={s.card} onPress={() => {}}>
          <Text style={s.title}>Go to {stopLabel} next?</Text>
          <Text style={s.sub}>Why? (optional) The office sees this with the change.</Text>
          <View style={{ gap: 8, marginTop: 12 }}>
            {REASONS.map((r) => (
              <TouchableOpacity key={r.key} style={s.option} activeOpacity={0.75} onPress={() => onPick(r.key)}
                accessibilityRole="button" accessibilityLabel={r.label}>
                <Text style={s.optionText}>{r.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <View style={s.row}>
            <TouchableOpacity onPress={onCancel} style={s.btn} accessibilityRole="button">
              <Text style={[s.btnText, { color: D.faint }]}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => onPick(null)} style={s.btn} accessibilityRole="button">
              <Text style={[s.btnText, { color: D.cyan }]}>Go without a reason</Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  )
}

const s = StyleSheet.create({
  backdrop:   { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', padding: 20 },
  card:       { backgroundColor: D.bg, borderRadius: 16, borderWidth: 1, borderColor: D.line, padding: 18 },
  title:      { color: D.white, fontSize: 16, fontWeight: '800' },
  sub:        { color: D.faint, fontSize: 12, marginTop: 4 },
  option:     { borderWidth: 1, borderColor: D.line, borderRadius: 10, paddingVertical: 11, paddingHorizontal: 12 },
  optionText: { color: D.white, fontSize: 14, fontWeight: '600' },
  row:        { flexDirection: 'row', justifyContent: 'space-between', marginTop: 14 },
  btn:        { paddingVertical: 8, paddingHorizontal: 4 },
  btnText:    { fontSize: 14, fontWeight: '700' },
})
