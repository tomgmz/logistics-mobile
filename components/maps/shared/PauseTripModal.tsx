import React, { useEffect, useState } from 'react'
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native'
import { PauseCircle, X } from 'lucide-react-native'

import { PAUSE_REASONS, type PauseReason } from '../../../lib/tripPause'
import { C } from '../../../theme/navigation.theme'

/**
 * "Why are you stopping?" — the reason the office and the client see, and a
 * note only the office sees.
 *
 * The note is required. A pause with no word on why is the phone call this
 * replaces, and the office can't decide whether to send help from a category
 * alone.
 */

interface Props {
  visible:   boolean
  onCancel:  () => void
  /** Resolves once the pause is durably queued; the modal shows a spinner until then. */
  onConfirm: (reason: PauseReason, note: string) => Promise<void> | void
}

const NOTE_MIN = 3

export function PauseTripModal({ visible, onCancel, onConfirm }: Props) {
  const [reason, setReason] = useState<PauseReason | null>(null)
  const [note,   setNote]   = useState('')
  const [busy,   setBusy]   = useState(false)

  // Each opening is a fresh pause.
  useEffect(() => {
    if (visible) { setReason(null); setNote(''); setBusy(false) }
  }, [visible])

  const canPause = !!reason && note.trim().length >= NOTE_MIN && !busy

  const submit = async () => {
    if (!canPause || !reason) return
    setBusy(true)
    try {
      await onConfirm(reason, note.trim())
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{
          flex: 1, backgroundColor: 'rgba(0,0,0,0.75)',
          alignItems: 'center', justifyContent: 'center', paddingHorizontal: 22,
        }}
      >
        <View
          style={{
            width: '100%', maxWidth: 420,
            backgroundColor: C.surface, borderRadius: 20,
            borderWidth: 1, borderColor: C.border,
            paddingHorizontal: 20, paddingTop: 18, paddingBottom: 16, gap: 14,
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 12 }}>
            <View style={{ flex: 1, gap: 3 }}>
              <Text style={{ color: C.white, fontSize: 18, fontWeight: '900' }}>Pause delivery</Text>
              <Text style={{ color: C.dimWhite, fontSize: 13, lineHeight: 19 }}>
                The office sees your note. The client only sees the reason.
              </Text>
            </View>
            <TouchableOpacity onPress={onCancel} hitSlop={10} style={{ padding: 2 }}>
              <X size={20} color={C.dimWhite} />
            </TouchableOpacity>
          </View>

          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {PAUSE_REASONS.map((r) => {
              const on = reason === r.key
              return (
                <TouchableOpacity
                  key={r.key}
                  onPress={() => setReason(r.key)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: on }}
                  style={{
                    paddingVertical: 9, paddingHorizontal: 12, borderRadius: 12,
                    borderWidth: 1,
                    borderColor:     on ? C.orange : C.border,
                    backgroundColor: on ? C.orangeDim : C.surfaceHi,
                  }}
                >
                  <Text style={{ color: on ? C.orange : C.white, fontSize: 13, fontWeight: '700' }}>{r.label}</Text>
                </TouchableOpacity>
              )
            })}
          </View>

          {reason === 'vehicle_breakdown' && (
            <Text style={{ color: C.dimWhite, fontSize: 12.5, lineHeight: 18 }}>
              This also sends a breakdown report to the Fleet Manager. For an accident or an emergency, use SOS instead.
            </Text>
          )}

          <TextInput
            value={note}
            onChangeText={setNote}
            placeholder="What happened? (required)"
            placeholderTextColor={C.dimmer}
            multiline
            maxLength={500}
            style={{
              color: C.white, fontSize: 14, minHeight: 80, paddingHorizontal: 12,
              paddingVertical: 10, borderRadius: 12, backgroundColor: C.surfaceHi,
              borderWidth: 1, borderColor: C.border, textAlignVertical: 'top',
            }}
          />

          <View style={{ flexDirection: 'row', gap: 10, marginTop: 2 }}>
            <TouchableOpacity
              onPress={onCancel}
              style={{
                flex: 1, paddingVertical: 14, borderRadius: 14, alignItems: 'center',
                backgroundColor: C.surfaceHi, borderWidth: 1, borderColor: C.border,
              }}
            >
              <Text style={{ color: C.dimWhite, fontSize: 14, fontWeight: '700' }}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => void submit()}
              disabled={!canPause}
              style={{
                flex: 1.3, paddingVertical: 14, borderRadius: 14,
                flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
                backgroundColor: canPause ? C.orange : C.surfaceHi,
                borderWidth: 1, borderColor: canPause ? C.orange : C.border,
                opacity: canPause ? 1 : 0.55,
              }}
            >
              {busy
                ? <ActivityIndicator size="small" color="#000" />
                : <PauseCircle size={17} color={canPause ? '#000' : C.dimmer} />}
              <Text style={{ color: canPause ? '#000' : C.dimmer, fontSize: 14, fontWeight: '800' }}>Pause delivery</Text>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  )
}
