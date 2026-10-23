import React, { useCallback, useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Modal, Text, TouchableOpacity, View } from 'react-native'
import { Mic, MicOff, Phone, PhoneOff } from 'lucide-react-native'

import { FONTS } from '../../lib/config/fonts'
import {
  endEmergencyCall,
  loadVoiceKit,
  microphoneAllowed,
  startEmergencyCall,
  type CallEndReason,
} from '../../lib/voiceCall'

/**
 * The driver's in-app emergency call to Operations, placed right after the
 * quick alert went out.
 *
 * It rings every Operations Manager's browser at once (Company Administrators
 * when there are none). Whenever the in-app call can't do its job, it hands over
 * to an ordinary phone call through `onFallback`:
 *   - the call can't be placed or can't connect;
 *   - nobody answers before the ring time runs out;
 *   - the connection drops mid-call (the driver gets a button, not an
 *     automatic redial, since they may be mid-sentence on a call that is
 *     already reconnecting).
 *
 * Cancel is the one exit that does NOT dial out: the driver chose to stop.
 */

const D = {
  card:    '#0e1010',
  line:    '#424242',
  white:   '#ffffff',
  faint:   '#818181',
  red:     '#f62626',
  redBg:   'rgba(246,38,38,0.19)',
  green:   '#3af626',
  overlay: 'rgba(0,0,0,0.85)',
}

/** How long the room may take to connect before the phone call is the better bet. */
const CONNECT_TIMEOUT_MS = 10_000

type Phase = 'starting' | 'ringing' | 'live' | 'dropped' | 'ended'

interface Props {
  /** The quick alert this call follows. */
  reportId:   string
  /** Dial out by phone instead. */
  onFallback: () => void
  /** The call is over and the screen should close. */
  onDone:     () => void
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error('timeout')), ms)),
  ])
}

export function EmergencyCallModal({ reportId, onFallback, onDone }: Props) {
  const [phase,   setPhase]   = useState<Phase>('starting')
  const [muted,   setMuted]   = useState(false)
  const [left,    setLeft]    = useState<number | null>(null)
  const [elapsed, setElapsed] = useState(0)
  const [note,    setNote]    = useState<string | null>(null)

  const roomRef   = useRef<any>(null)
  const callIdRef = useRef<string | null>(null)
  const phaseRef  = useRef<Phase>('starting')
  const closedRef = useRef(false)
  const kit       = loadVoiceKit()

  const go = (p: Phase) => { phaseRef.current = p; setPhase(p) }

  /** Leave the room and stop the audio session. Safe to call twice. */
  const teardown = useCallback(async () => {
    const room = roomRef.current
    roomRef.current = null
    if (room) {
      room.removeAllListeners?.()
      await room.disconnect?.().catch?.(() => {})
    }
    await kit?.AudioSession.stopAudioSession().catch(() => {})
  }, [kit])

  /** Close the call once, telling the server why, and optionally dial out. */
  const finish = useCallback(async (reason: CallEndReason, dialOut: boolean, detail?: string) => {
    if (closedRef.current) return
    closedRef.current = true
    await teardown()
    if (callIdRef.current) void endEmergencyCall(callIdRef.current, reason, detail)
    if (dialOut) {
      onDone()
      onFallback()
    }
  }, [teardown, onDone, onFallback])

  // Place the call.
  useEffect(() => {
    let cancelled = false

    ;(async () => {
      if (!kit || !(await microphoneAllowed())) {
        closedRef.current = true
        onDone(); onFallback()
        return
      }

      let started
      try {
        started = await startEmergencyCall(reportId)
      } catch {
        closedRef.current = true
        if (!cancelled) { onDone(); onFallback() }
        return
      }
      if (cancelled) return
      callIdRef.current = started.call_id

      // Which step threw, so a failed call says where it broke.
      let step = 'audio session'
      try {
        await kit.AudioSession.configureAudio({
          // Speaker first: the driver may be out of the cab or have their hands full.
          android: {
            preferredOutputList: ['speaker', 'bluetooth', 'headset', 'earpiece'],
            audioTypeOptions:    kit.AndroidAudioTypePresets.communication,
          },
          ios:     { defaultOutput: 'speaker' },
        })
        await kit.AudioSession.startAudioSession()

        const room = new kit.Room({ adaptiveStream: false, dynacast: false })
        roomRef.current = room

        const answered = () => {
          if (phaseRef.current === 'ringing') { go('live'); setLeft(null) }
        }
        room.on(kit.RoomEvent.ParticipantConnected, answered)
        room.on(kit.RoomEvent.ParticipantDisconnected, () => {
          if (phaseRef.current !== 'live') return
          setNote('Operations ended the call.')
          go('ended')
          void finish('hangup', false)
        })
        room.on(kit.RoomEvent.Disconnected, () => {
          if (closedRef.current) return
          if (phaseRef.current === 'live') {
            setNote('The call dropped. Call Operations by phone if you still need them.')
            go('dropped')
          }
        })

        step = 'connect'
        await withTimeout(room.connect(started.url, started.token), CONNECT_TIMEOUT_MS)
        if (cancelled) return
        step = 'microphone'
        await room.localParticipant.setMicrophoneEnabled(true)

        go('ringing')
        setLeft(started.ring_seconds)
        // Someone may have answered while we were still connecting.
        if (room.remoteParticipants.size > 0) answered()
      } catch (e: any) {
        const detail = `${step}: ${e?.message ?? String(e)}`
        console.warn('[emergency call] failed at', detail)
        if (!cancelled) void finish('failed', true, detail)
      }
    })()

    return () => {
      cancelled = true
      void teardown()
    }
  }, [])

  // Ring countdown → no answer → phone call.
  useEffect(() => {
    if (phase !== 'ringing' || left == null) return
    if (left <= 0) { void finish('no_answer', true); return }
    const t = setTimeout(() => setLeft((s) => (s == null ? s : s - 1)), 1000)
    return () => clearTimeout(t)
  }, [phase, left, finish])

  // Call timer.
  useEffect(() => {
    if (phase !== 'live') return
    const t = setInterval(() => setElapsed((s) => s + 1), 1000)
    return () => clearInterval(t)
  }, [phase])

  const toggleMute = async () => {
    const room = roomRef.current
    if (!room) return
    try {
      await room.localParticipant.setMicrophoneEnabled(muted)
      setMuted(!muted)
    } catch {}
  }

  const title =
    phase === 'starting' ? 'CONNECTING…'
    : phase === 'ringing' ? 'CALLING OPERATIONS'
    : phase === 'live'    ? 'ON CALL WITH OPERATIONS'
    : phase === 'dropped' ? 'CALL DROPPED'
    : 'CALL ENDED'

  const sub =
    phase === 'starting' ? 'Your alert was sent. Connecting the call…'
    : phase === 'ringing' ? `Ringing the Operations Manager on duty${left != null ? ` · ${left}s` : ''}. If nobody answers, your phone will call them.`
    : phase === 'live'    ? `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, '0')}`
    : note ?? ''

  return (
    <Modal visible transparent animationType="fade" onRequestClose={() => {}}>
      <View style={{ flex: 1, backgroundColor: D.overlay, alignItems: 'center', justifyContent: 'center', padding: 20 }}>
        <View style={{
          width: '100%', maxWidth: 340, backgroundColor: D.card,
          borderWidth: 0.5, borderColor: D.red, borderRadius: 15, padding: 18, gap: 12,
        }}>
          <Text style={{ color: D.red, fontSize: 15, letterSpacing: 0.3, fontFamily: FONTS.spartan.bold }}>
            {title}
          </Text>
          <Text style={{ color: D.white, fontSize: 14, lineHeight: 19, fontFamily: FONTS.spartan.medium }}>
            {sub}
          </Text>
          {phase === 'live' && note ? (
            <Text style={{ color: D.faint, fontSize: 12, fontFamily: FONTS.spartan.medium }}>{note}</Text>
          ) : null}

          {phase === 'starting' && <ActivityIndicator color={D.red} />}

          {phase === 'ringing' && (
            <View style={{ gap: 10 }}>
              <Button label="Call by phone instead" color={D.white} icon={<Phone size={16} color={D.white} />}
                onPress={() => void finish('fell_back', true)} />
              <Button label="Cancel call" color={D.red} filled icon={<PhoneOff size={16} color={D.red} />}
                onPress={() => { void finish('hangup', false); onDone() }} />
            </View>
          )}

          {phase === 'live' && (
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <View style={{ flex: 1 }}>
                <Button label={muted ? 'Unmute' : 'Mute'} color={D.white}
                  icon={muted ? <MicOff size={16} color={D.white} /> : <Mic size={16} color={D.white} />}
                  onPress={() => void toggleMute()} />
              </View>
              <View style={{ flex: 1 }}>
                <Button label="Hang up" color={D.red} filled icon={<PhoneOff size={16} color={D.red} />}
                  onPress={() => { void finish('hangup', false); onDone() }} />
              </View>
            </View>
          )}

          {phase === 'dropped' && (
            <View style={{ gap: 10 }}>
              <Button label="Call by phone" color={D.green} icon={<Phone size={16} color={D.green} />}
                onPress={() => void finish('fell_back', true)} />
              <Button label="Close" color={D.faint}
                onPress={() => { void finish('hangup', false); onDone() }} />
            </View>
          )}

          {phase === 'ended' && (
            <Button label="Close" color={D.faint} onPress={onDone} />
          )}
        </View>
      </View>
    </Modal>
  )
}

function Button({
  label, color, icon, filled, onPress,
}: { label: string; color: string; icon?: React.ReactNode; filled?: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.8}
      accessibilityRole="button"
      style={{
        flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
        paddingVertical: 12, borderRadius: 10, borderWidth: 1,
        borderColor: filled ? color : D.line,
        backgroundColor: filled ? D.redBg : 'transparent',
      }}
    >
      {icon}
      <Text style={{ color, fontSize: 14, fontFamily: FONTS.spartan.bold }}>{label}</Text>
    </TouchableOpacity>
  )
}
