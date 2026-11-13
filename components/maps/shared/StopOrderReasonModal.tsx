import React, { useEffect, useState } from 'react'
import { Modal, Pressable, StyleSheet, Text, TouchableOpacity, View } from 'react-native'

/**
 * "Go to Drop-off 3 next?" — the confirmation, and an optional reason the
 * office sees with the change. Tapping a reason only selects it (tap again to
 * clear); nothing changes until Confirm. Cancel changes nothing.
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
  const [picked, setPicked] = useState<StopOrderReason | null>(null)
  // Each opening starts with nothing selected.
  useEffect(() => { if (visible) setPicked(null) }, [visible])
  const pickedLabel = REASONS.find((r) => r.key === picked)?.label

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <Pressable style={s.backdrop} onPress={onCancel}>
        <Pressable style={s.card} onPress={() => {}}>
          <Text style={s.title}>Go to {stopLabel} next?</Text>
          <Text style={s.sub}>Why? (optional) The office sees this with the change.</Text>
          <View style={{ gap: 8, marginTop: 12 }}>
            {REASONS.map((r) => {
              const on = picked === r.key
              return (
                <TouchableOpacity key={r.key} style={on ? [s.option, s.optionOn] : s.option} activeOpacity={0.75}
                  onPress={() => setPicked(on ? null : r.key)}
                  accessibilityRole="radio" accessibilityState={{ selected: on }} accessibilityLabel={r.label}>
                  <View style={on ? [s.dot, s.dotOn] : s.dot} />
                  <Text style={s.optionText}>{r.label}</Text>
                </TouchableOpacity>
              )
            })}
          </View>
          <Text style={s.summary}>
            {pickedLabel ? `Reason: ${pickedLabel}` : 'No reason selected'}
          </Text>
          <View style={s.row}>
            <TouchableOpacity onPress={onCancel} style={s.btn} accessibilityRole="button">
              <Text style={[s.btnText, { color: D.faint }]}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => onPick(picked)} style={s.confirm} activeOpacity={0.8} accessibilityRole="button">
              <Text style={s.confirmText}>{picked ? 'Confirm' : 'Confirm without a reason'}</Text>
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
  option:     { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderColor: D.line, borderRadius: 10, paddingVertical: 11, paddingHorizontal: 12 },
  optionOn:   { borderColor: D.cyan, backgroundColor: 'rgba(77,249,237,0.08)' },
  dot:        { width: 16, height: 16, borderRadius: 8, borderWidth: 2, borderColor: D.faint },
  dotOn:      { borderColor: D.cyan, backgroundColor: D.cyan },
  optionText: { color: D.white, fontSize: 14, fontWeight: '600', flexShrink: 1 },
  summary:    { color: D.faint, fontSize: 12, marginTop: 12 },
  row:        { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 10, gap: 10 },
  confirm:    { backgroundColor: D.cyan, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 14, flexShrink: 1 },
  confirmText:{ color: '#000000', fontSize: 14, fontWeight: '800', textAlign: 'center' },
  btn:        { paddingVertical: 8, paddingHorizontal: 4 },
  btnText:    { fontSize: 14, fontWeight: '700' },
})
