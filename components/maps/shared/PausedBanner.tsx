import React, { useCallback, useEffect, useState } from 'react'
import {
  ActivityIndicator, Alert, KeyboardAvoidingView, Modal, Platform, Text, TextInput,
  TouchableOpacity, View, type ViewStyle,
} from 'react-native'
import { PauseCircle } from 'lucide-react-native'

import { pauseReasonLabel, resumeRequestOpen, type TripPause } from '../../../lib/tripPause'
import { requestResume, resumeRequestQueued } from '../../../lib/resumeRequest'
import { C } from '../../../theme/navigation.theme'

/**
 * "Delivery paused" with the reason and when it started. Only the office
 * (Operations or the Company Administrator) pauses and resumes a delivery. Shown
 * on the navigation map and on the booking screen, so a paused driver can't miss
 * it in either place.
 *
 * With `bookingId`, it also carries "Ready to continue": the driver tells the
 * office the delivery can move again. That never resumes it; the office ends the
 * pause, or answers "Not yet" with a reason (a notification).
 */

const NOTE_MAX = 300

function timeLabel(iso: string | null | undefined): string {
  if (!iso) return ''
  const t = new Date(iso)
  return isNaN(t.getTime())
    ? ''
    : t.toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' })
}

/** "Nov 5" from YYYY-MM-DD, as a calendar day. */
function dayLabel(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' })
}

/** "8:00 AM" from HH:MM. */
function clockLabel(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number)
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`
}

export function PausedBanner({
  pause, style, bookingId, onChanged,
}: {
  pause:      TripPause
  style?:     ViewStyle
  /** Shows "Ready to continue" when set. */
  bookingId?: string
  /** Re-read the booking after a request went out. */
  onChanged?: () => void
}) {
  const since = timeLabel(pause.pausedAt)
  const asked = resumeRequestOpen(pause)

  const [queued, setQueued]   = useState(false)
  const [writing, setWriting] = useState(false)
  const [note, setNote]       = useState('')
  const [busy, setBusy]       = useState(false)

  const checkQueued = useCallback(async () => {
    if (!bookingId) return
    setQueued(await resumeRequestQueued(bookingId))
  }, [bookingId])

  // Re-checked whenever the pause read changes (the banner's own 30 s refresh).
  useEffect(() => { void checkQueued() }, [checkQueued, pause.requestedAt, pause.declinedAt, pause.pausedAt])

  async function send() {
    if (!bookingId || busy) return
    setBusy(true)
    try {
      const result = await requestResume(bookingId, note)
      setWriting(false)
      setNote('')
      if (typeof result === 'object') {
        Alert.alert('Not sent', result.refused)
      } else if (result === 'queued') {
        Alert.alert('Saved on your phone', 'No signal right now. It is sent to the office as soon as you have signal.')
      } else if (result === 'not_paused') {
        Alert.alert('Already moving', 'The office has already ended the pause.')
      } else {
        Alert.alert('Office told', 'The office has your request. Wait until they resume the delivery or answer you.')
      }
      await checkQueued()
      onChanged?.()
    } finally {
      setBusy(false)
    }
  }

  const declinedLater = !asked && !!pause.declinedAt
  const canAsk = !!bookingId && !asked && !queued

  return (
    <View
      style={[{
        flexDirection: 'row', alignItems: 'center', gap: 10,
        paddingVertical: 10, paddingHorizontal: 12, borderRadius: 14,
        backgroundColor: C.offlineBg, borderWidth: 1, borderColor: C.offlineBorder,
      }, style]}
    >
      <PauseCircle size={20} color={C.orange} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ color: C.orange, fontSize: 13, fontWeight: '800' }} numberOfLines={1}>
          Delivery paused · {pauseReasonLabel(pause.reason)}
        </Text>
        {!!pause.note && (
          <Text style={{ color: C.dimWhite, fontSize: 12, lineHeight: 17 }} numberOfLines={2}>{pause.note}</Text>
        )}
        {!!pause.continuesOn && (
          <Text style={{ color: C.dimWhite, fontSize: 12, fontWeight: '700' }}>
            Continues {dayLabel(pause.continuesOn)}
            {pause.continuesCall ? ` · your call time ${clockLabel(pause.continuesCall)}` : ''}
          </Text>
        )}
        <Text style={{ color: C.dimmer, fontSize: 11 }}>
          {since ? `Since ${since} · ` : ''}Paused by the office. Wait until they resume it.
        </Text>

        {!!bookingId && asked && (
          <Text style={{ color: C.cyan, fontSize: 12, fontWeight: '700' }}>
            You asked to continue{timeLabel(pause.requestedAt) ? ` at ${timeLabel(pause.requestedAt)}` : ''}. Waiting for the office.
          </Text>
        )}
        {!!bookingId && !asked && queued && (
          <Text style={{ color: C.cyan, fontSize: 12, fontWeight: '700' }}>
            Ready to continue: saved, sent when you have signal.
          </Text>
        )}
        {!!bookingId && declinedLater && !queued && (
          <Text style={{ color: C.dimWhite, fontSize: 12 }}>
            The office said not yet{timeLabel(pause.declinedAt) ? ` at ${timeLabel(pause.declinedAt)}` : ''}. Their reason is in your notifications.
          </Text>
        )}
        {canAsk && (
          <TouchableOpacity
            onPress={() => setWriting(true)}
            accessibilityRole="button"
            style={{
              alignSelf: 'flex-start', marginTop: 6, paddingVertical: 7, paddingHorizontal: 12,
              borderRadius: 10, borderWidth: 1, borderColor: C.cyan, backgroundColor: C.cyanDim,
            }}
          >
            <Text style={{ color: C.cyan, fontSize: 13, fontWeight: '800' }}>Ready to continue</Text>
          </TouchableOpacity>
        )}
      </View>

      <Modal visible={writing} transparent animationType="fade" onRequestClose={() => { if (!busy) setWriting(false) }}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', padding: 20 }}
        >
          <View style={{ backgroundColor: '#1a1a1a', borderRadius: 16, borderWidth: 1, borderColor: '#424242', padding: 18, gap: 12 }}>
            <Text style={{ color: '#fff', fontSize: 17, fontWeight: '800' }}>Ready to continue?</Text>
            <Text style={{ color: C.dimWhite, fontSize: 13, lineHeight: 19 }}>
              The office is told you are ready to move again. The delivery stays paused until they resume it.
            </Text>
            <TextInput
              value={note}
              onChangeText={(t) => setNote(t.slice(0, NOTE_MAX))}
              placeholder="Optional: e.g. The road is open again."
              placeholderTextColor={C.dimmer}
              multiline
              maxLength={NOTE_MAX}
              editable={!busy}
              style={{
                minHeight: 80, color: '#fff', fontSize: 14, textAlignVertical: 'top',
                borderWidth: 1, borderColor: '#424242', borderRadius: 10, padding: 10, backgroundColor: '#0a0a0a',
              }}
            />
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <TouchableOpacity
                disabled={busy}
                onPress={() => setWriting(false)}
                style={{ flex: 1, minHeight: 46, borderRadius: 10, borderWidth: 1, borderColor: '#818181', alignItems: 'center', justifyContent: 'center' }}
              >
                <Text style={{ color: '#ccc', fontSize: 15, fontWeight: '700' }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                disabled={busy}
                onPress={() => void send()}
                style={{ flex: 1, minHeight: 46, borderRadius: 10, borderWidth: 1, borderColor: C.cyan, backgroundColor: C.cyanDim, alignItems: 'center', justifyContent: 'center' }}
              >
                {busy
                  ? <ActivityIndicator color={C.cyan} />
                  : <Text style={{ color: C.cyan, fontSize: 15, fontWeight: '800' }}>Tell the office</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  )
}
