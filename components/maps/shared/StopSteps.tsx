import React from 'react'
import { Alert, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { Clock } from 'lucide-react-native'

import { nextStep, stepLabel, type StepStage, type StepTimes } from '../../../lib/stopSteps'

const D = {
  cyan:  '#4df9ed',
  white: '#ffffff',
  faint: '#818181',
  line:  '#3a3a3a',
}

/** "09:42" in Philippine time — the driver's own clock may be wrong. */
function hhmm(iso: string): string {
  const d = new Date(Date.parse(iso) + 8 * 3600_000)
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`
}

const SHORT: Record<StepStage | 'finished', string> = {
  arrived_parking: 'Parking',
  docked:          'Dock',
  started:         'Start',
  finished:        'Finish',
  departed:        'Left',
}
const ORDER: Array<StepStage | 'finished'> = ['arrived_parking', 'docked', 'started', 'finished', 'departed']

/**
 * The times tapped at one stop, and the button for the next one. The finish is
 * the proof confirmation, done with the stop's own button; this never blocks
 * it, so a driver who forgot a step can still confirm the stop.
 */
export function StopSteps({ kind, times, onRecord, compact = false, showButton = true }: {
  kind:       'pickup' | 'dropoff'
  times:      StepTimes
  onRecord:   (stage: StepStage) => void
  compact?:   boolean
  /** False on a stop not yet reached — its times only, no button. */
  showButton?: boolean
}) {
  const next = showButton ? nextStep(times) : null
  const done = ORDER.filter((s) => times[s])

  return (
    <View style={{ gap: 6 }}>
      {done.length > 0 && (
        <View style={s.row}>
          <Clock size={11} color={D.faint} />
          <Text style={[s.times, compact && { fontSize: 10 }]} numberOfLines={2}>
            {done.map((st) => `${SHORT[st]} ${hhmm(times[st]!)}`).join(' · ')}
          </Text>
        </View>
      )}
      {next && (
        <TouchableOpacity
          onPress={() => {
            const label = stepLabel(next, kind)
            Alert.alert(label, 'Record this time now?', [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Record', onPress: () => onRecord(next) },
            ])
          }}
          activeOpacity={0.75}
          accessibilityRole="button"
          accessibilityLabel={`Record: ${stepLabel(next, kind)}`}
          style={[s.btn, compact && { paddingVertical: 6 }]}
        >
          <Clock size={13} color={D.cyan} />
          <Text style={s.btnText}>{stepLabel(next, kind)}</Text>
        </TouchableOpacity>
      )}
    </View>
  )
}

const s = StyleSheet.create({
  row:   { flexDirection: 'row', alignItems: 'center', gap: 5 },
  times: { color: D.faint, fontSize: 11, flex: 1 },
  btn: {
    flexDirection:   'row',
    alignItems:      'center',
    alignSelf:       'flex-start',
    gap:             6,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius:    8,
    borderWidth:     1,
    borderColor:     'rgba(77,249,237,0.35)',
    backgroundColor: 'rgba(77,249,237,0.10)',
  },
  btnText: { color: D.cyan, fontSize: 13, fontWeight: '700' },
})
