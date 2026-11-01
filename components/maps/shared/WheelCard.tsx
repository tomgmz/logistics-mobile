import React, { useCallback, useEffect, useState } from 'react'
import { Alert, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { RefreshCw } from 'lucide-react-native'

import api from '../../../lib/api/auth.api'
import { enqueue, flush } from '../../../lib/offlineQueue'
import { readCurrentFix } from '../../../lib/stopGeofence'

/**
 * Who is at the wheel, on a booking with a second driver. Either crew member
 * taps "I'm taking the wheel" when they swap; the office uses the record for
 * rest hours, traffic fines and accidents. The phone can't see who drives, so
 * this is the crew's word, sent through the offline queue with the phone's time
 * (corrected by the server like every other tap).
 */

const D = {
  cyan:  '#4df9ed',
  white: '#ffffff',
  faint: '#818181',
  line:  '#3a3a3a',
}

interface Shift {
  driver_id:   string
  driver_name: string | null
  started_at:  string
  ended_at:    string | null
}

/** "14:05" in Philippine time. */
function hhmm(iso: string): string {
  const d = new Date(Date.parse(iso) + 8 * 3600_000)
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`
}

export function WheelCard({ bookingId, myName }: { bookingId: string; myName: string }) {
  const [current, setCurrent] = useState<Shift | null>(null)
  const [mine,    setMine]    = useState<{ at: string } | null>(null)

  const load = useCallback(async () => {
    try {
      const { data } = await api.get(`/driver/bookings/${bookingId}/driving`)
      const open = ((data?.data ?? []) as Shift[]).find((s) => !s.ended_at) ?? null
      setCurrent(open)
      setMine(null)
    } catch { /* offline: the last answer (or this phone's tap) stands */ }
  }, [bookingId])
  useEffect(() => { void load() }, [load])

  async function takeWheel() {
    const at = new Date().toISOString()
    setMine({ at })
    const fix = await Promise.race([
      readCurrentFix().catch(() => null),
      new Promise<null>((r) => setTimeout(() => r(null), 3000)),
    ])
    await enqueue({
      id:     `wheel:${bookingId}:${Date.parse(at)}`,
      kind:   'wheel',
      method: 'post',
      url:    `/driver/bookings/${bookingId}/driving`,
      body:   { at, ...(fix ? { latitude: fix.latitude, longitude: fix.longitude } : {}) },
    })
    void flush().then(load)
  }

  const who = mine ? `${myName || 'You'} (you)` : current?.driver_name ?? null
  const since = mine?.at ?? current?.started_at ?? null

  return (
    <View style={s.card}>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={s.label}>AT THE WHEEL</Text>
        <Text style={s.who} numberOfLines={1}>{who ?? 'Not recorded yet'}</Text>
        {since && <Text style={s.since}>since {hhmm(since)}</Text>}
      </View>
      <TouchableOpacity
        activeOpacity={0.75}
        accessibilityRole="button"
        accessibilityLabel="I'm taking the wheel"
        onPress={() => Alert.alert('Taking the wheel?', 'Record that you are driving from now on.', [
          { text: 'Cancel', style: 'cancel' },
          { text: 'I’m driving', onPress: () => { void takeWheel() } },
        ])}
        style={s.btn}
      >
        <RefreshCw size={14} color={D.cyan} />
        <Text style={s.btnText}>I’m taking the wheel</Text>
      </TouchableOpacity>
    </View>
  )
}

const s = StyleSheet.create({
  card: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingVertical: 10, paddingHorizontal: 12, borderRadius: 14,
    borderWidth: 1, borderColor: D.line,
  },
  label:   { color: D.faint, fontSize: 10, fontWeight: '700', letterSpacing: 1 },
  who:     { color: D.white, fontSize: 14, fontWeight: '700' },
  since:   { color: D.faint, fontSize: 11 },
  btn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingVertical: 8, paddingHorizontal: 12, borderRadius: 8,
    borderWidth: 1, borderColor: 'rgba(77,249,237,0.35)', backgroundColor: 'rgba(77,249,237,0.10)',
  },
  btnText: { color: D.cyan, fontSize: 13, fontWeight: '700' },
})
