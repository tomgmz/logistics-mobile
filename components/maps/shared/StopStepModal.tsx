import React, { useState } from 'react'
import { ActivityIndicator, Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { CheckCircle2, Circle, Clock, MapPin } from 'lucide-react-native'

import {
  ARRIVAL_RADIUS_M, nextStep, stepDoneLabel, stepLabel,
  type StepStage, type StepTimes,
} from '../../../lib/stopSteps'
import { distanceInMetres, readCurrentFix } from '../../../lib/stopGeofence'

const D = {
  bg:    '#161616',
  card:  '#1f1f1f',
  cyan:  '#4df9ed',
  green: '#3AF626',
  white: '#ffffff',
  faint: '#818181',
  line:  '#333333',
  red:   '#F62626',
}

/** "09:42" in Philippine time; the driver's own clock may be wrong. */
function hhmm(iso: string): string {
  const d = new Date(Date.parse(iso) + 8 * 3600_000)
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`
}

const STEPS: Array<StepStage | 'proof'> = ['arrived', 'started', 'finished', 'proof']

/**
 * The steps at one stop visit, one button at a time (user 2026-11-12, no step
 * skipped):
 *
 *   I've arrived (within 300 m) → Start loading/unloading →
 *   Loading/Unloading finished → the proof popup
 *
 * Opens by itself when navigation detects the arrival (the arrival is then
 * already recorded, so it shows Start), and from the stop's confirm button.
 * Recording Finished hands straight over to the proof popup (onProof).
 */
export function StopStepModal({ visible, kind, label, times, stop, onRecord, onProof, onClose }: {
  visible:  boolean
  kind:     'pickup' | 'dropoff'
  /** "Pickup" / "Drop-off 2 · Commonwealth Avenue". */
  label:    string
  times:    StepTimes
  /** The stop's position, for the 300 m arrival check. Null when not on file. */
  stop:     { latitude: number; longitude: number } | null
  onRecord: (stage: StepStage) => Promise<boolean>
  onProof:  () => void
  onClose:  () => void
}) {
  const [busy, setBusy]   = useState(false)
  const [error, setError] = useState<string | null>(null)
  const next = nextStep(times)

  const press = async () => {
    if (!next || busy) return
    setError(null)
    if (next === 'proof') { onProof(); return }
    setBusy(true)
    try {
      if (next === 'arrived') {
        // Logged at the stop, not before it.
        const fix = await Promise.race([
          readCurrentFix().catch(() => null),
          new Promise<null>((r) => setTimeout(() => r(null), 8000)),
        ])
        if (!fix) {
          setError('Your location could not be read. Move to open sky and try again, or ask the office to confirm the arrival.')
          return
        }
        if (stop) {
          const off   = distanceInMetres({ latitude: fix.latitude, longitude: fix.longitude }, stop)
          const slack = Math.min(Math.max(fix.accuracy_m ?? 0, 0), 100)
          if (off - slack > ARRIVAL_RADIUS_M) {
            setError(`You are about ${off >= 1000 ? `${(off / 1000).toFixed(1)} km` : `${Math.round(off)} m`} from the ${kind === 'pickup' ? 'pickup' : 'drop-off'}. The arrival can be logged within ${ARRIVAL_RADIUS_M} m of it.`)
            return
          }
        }
      }
      const ok = await onRecord(next)
      if (!ok) { setError('Do the step before this one first.'); return }
      // Loading/Unloading finished: the proof comes next, at once.
      if (next === 'finished') onProof()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={s.backdrop}>
        <View style={s.sheet}>
          <View style={s.head}>
            <MapPin size={16} color={D.cyan} />
            <Text style={s.title} numberOfLines={2}>{label}</Text>
          </View>

          <View style={{ gap: 10, marginTop: 14 }}>
            {STEPS.map((st) => {
              const at   = times[st]
              const isNext = st === next
              return (
                <View key={st} style={s.stepRow}>
                  {at ? <CheckCircle2 size={18} color={D.green} />
                    : <Circle size={18} color={isNext ? D.cyan : D.faint} />}
                  <Text style={[s.stepText, at ? { color: D.white } : isNext ? { color: D.cyan } : null]}>
                    {at ? stepDoneLabel(st, kind) : stepLabel(st, kind)}
                  </Text>
                  {at && <Text style={s.stepTime}>{hhmm(at)}</Text>}
                </View>
              )
            })}
          </View>

          {error && <Text style={s.error}>{error}</Text>}

          {next && (
            <TouchableOpacity
              onPress={() => { void press() }}
              disabled={busy}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityLabel={stepLabel(next, kind)}
              style={[s.primary, busy && { opacity: 0.6 }]}
            >
              {busy ? <ActivityIndicator color="#000" /> : (
                <>
                  <Clock size={16} color="#000" />
                  <Text style={s.primaryText}>{stepLabel(next, kind)}</Text>
                </>
              )}
            </TouchableOpacity>
          )}

          <TouchableOpacity onPress={onClose} activeOpacity={0.7} style={s.close} accessibilityRole="button">
            <Text style={s.closeText}>Close</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  )
}

const s = StyleSheet.create({
  backdrop:  { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  sheet:     { backgroundColor: D.bg, borderTopLeftRadius: 18, borderTopRightRadius: 18, padding: 18, paddingBottom: 28, borderTopWidth: 1, borderColor: D.line },
  head:      { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title:     { color: D.white, fontSize: 16, fontWeight: '700', flex: 1 },
  stepRow:   { flexDirection: 'row', alignItems: 'center', gap: 10 },
  stepText:  { color: D.faint, fontSize: 14, flex: 1 },
  stepTime:  { color: D.faint, fontSize: 13 },
  error:     { color: D.red, fontSize: 13, marginTop: 12 },
  primary:   { marginTop: 18, backgroundColor: D.cyan, borderRadius: 12, paddingVertical: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  primaryText: { color: '#000', fontSize: 15, fontWeight: '800' },
  close:     { marginTop: 10, alignItems: 'center', paddingVertical: 8 },
  closeText: { color: D.faint, fontSize: 13 },
})
