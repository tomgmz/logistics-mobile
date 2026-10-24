import React, { useCallback, useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Alert, AppState, Modal, Text, TouchableOpacity, Vibration, View } from 'react-native'
import { Mic, MicOff, Phone, PhoneOff } from 'lucide-react-native'

import { supabase } from '../../lib/supabase'
import { FONTS } from '../../lib/config/fonts'
import { roleLabel } from '../../lib/roles'
import { loadVoiceKit, microphoneAllowed } from '../../lib/voiceCall'
import {
  answerChatCall,
  declineChatCall,
  endChatCall,
  ringingChatCalls,
  startChatCall,
  useChatCallStore,
  type CallRequest,
  type ChatCallView,
} from '../../lib/chatCall'

/**
 * Voice calls from Messages, on the phone.
 *
 * Mounted once in the driver layout, so a call rings on whatever screen is
 * open. It places calls for the chat header's call button, rings (vibrates)
 * when someone calls, and runs the call: mute and hang up.
 *
 * The caller joins the LiveKit room as soon as the call is placed; the call is
 * live when the other person joins. With the app in the background the ring
 * arrives as a push; opening the app shows the ringer if it is still ringing.
 * Unlike the emergency call there is no fallback to the dialer: this is an
 * ordinary call, and a failed one just says so.
 */

const D = {
  card:    '#0e1010',
  line:    '#424242',
  white:   '#ffffff',
  faint:   '#818181',
  cyan:    '#4df9ed',
  red:     '#f62626',
  redBg:   'rgba(246,38,38,0.19)',
  green:   '#3af626',
  greenBg: 'rgba(58,246,38,0.15)',
  orange:  '#ff7a30',
  overlay: 'rgba(0,0,0,0.85)',
}

/** How long the room may take to connect before the call counts as failed. */
const CONNECT_TIMEOUT_MS = 10_000
/** A ringer older than this is dropped even if no close event arrived. */
const RING_MAX_MS = 75_000
/** How long "Call ended" stays up before the sheet closes by itself. */
const ENDED_LINGER_MS = 3_000

const MIC_PROMPT = 'Allow the microphone so the other person can hear you on the call.'

type Phase = 'placing' | 'ringing' | 'connecting' | 'live' | 'ended'

interface ActiveCall {
  direction: 'out' | 'in'
  peerName:  string
  peerRole:  string
  phase:     Phase
  muted:     boolean
  startedAt: number | null
  ringLeft:  number | null
  note:      string | null
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error('timeout')), ms)),
  ])
}

function errorMessage(e: unknown, fallback: string): string {
  const err = e as { response?: { data?: { message?: string } }; message?: string } | null
  return err?.response?.data?.message ?? fallback
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  return ((parts[0]?.[0] ?? '?') + (parts[1]?.[0] ?? '')).toUpperCase()
}

export function ChatCallHost({ userId }: { userId: string }) {
  const setPlaceCall = useChatCallStore((s) => s.setPlaceCall)
  const setInCall    = useChatCallStore((s) => s.setInCall)

  const [ringing,   setRinging]   = useState<ChatCallView[]>([])
  const [active,    setActive]    = useState<ActiveCall | null>(null)
  const [answering, setAnswering] = useState<string | null>(null)
  const [now,       setNow]       = useState(() => Date.now())

  const roomRef    = useRef<any>(null)
  const dismissed  = useRef<Set<string>>(new Set())
  const activeRef  = useRef<ActiveCall | null>(null)
  const callIdRef  = useRef<string | null>(null)
  // Bumped whenever the current attempt is abandoned, so an await that finishes
  // afterwards knows its call is no longer wanted.
  const attemptRef = useRef(0)

  useEffect(() => { activeRef.current = active }, [active])

  const dropRinging = useCallback((callId: string) => {
    setRinging((list) => list.filter((c) => c.call_id !== callId))
  }, [])

  const addRinging = useCallback((call: ChatCallView) => {
    if (!call?.call_id || call.callee_id !== userId || dismissed.current.has(call.call_id)) return
    setRinging((list) => (list.some((c) => c.call_id === call.call_id) ? list : [call, ...list]))
  }, [userId])

  /** Leave the room and stop the audio session. Safe to call twice. */
  const teardown = useCallback(() => {
    const room = roomRef.current
    roomRef.current = null
    if (room) {
      room.removeAllListeners?.()
      void room.disconnect?.()?.catch?.(() => {})
    }
    void loadVoiceKit()?.AudioSession.stopAudioSession().catch(() => {})
  }, [])

  useEffect(() => () => teardown(), [teardown])

  const finishLocal = useCallback((note: string) => {
    attemptRef.current += 1
    teardown()
    setActive((a) => (a && a.phase !== 'ended' ? { ...a, phase: 'ended', note, ringLeft: null } : a))
  }, [teardown])

  /** Join the room with the microphone on. Throws with the step that broke. */
  const joinRoom = useCallback(async (url: string, token: string) => {
    const kit = loadVoiceKit()
    if (!kit) throw new Error('no voice kit')

    let step = 'audio session'
    try {
      await kit.AudioSession.configureAudio({
        android: {
          preferredOutputList: ['speaker', 'bluetooth', 'headset', 'earpiece'],
          audioTypeOptions:    kit.AndroidAudioTypePresets.communication,
        },
        ios: { defaultOutput: 'speaker' },
      })
      await kit.AudioSession.startAudioSession()

      const room = new kit.Room({ adaptiveStream: false, dynacast: false })
      roomRef.current = room

      // The callee joining is what "answered" means to the caller.
      room.on(kit.RoomEvent.ParticipantConnected, () => {
        setActive((a) => (a && a.phase === 'ringing' ? { ...a, phase: 'live', startedAt: Date.now(), ringLeft: null } : a))
      })
      room.on(kit.RoomEvent.ParticipantDisconnected, () => {
        const id = callIdRef.current
        if (id) void endChatCall(id)
        finishLocal(`${activeRef.current?.peerName ?? 'They'} hung up.`)
      })
      room.on(kit.RoomEvent.Disconnected, () => finishLocal('The call dropped.'))

      step = 'connect'
      await withTimeout(room.connect(url, token), CONNECT_TIMEOUT_MS)
      step = 'microphone'
      await room.localParticipant.setMicrophoneEnabled(true)
      return room
    } catch (e: any) {
      throw new Error(`${step}: ${e?.message ?? String(e)}`)
    }
  }, [finishLocal])

  /** The checks before any call: this build has LiveKit, and the mic is allowed. */
  const canTalk = useCallback(async (): Promise<boolean> => {
    if (!loadVoiceKit()) {
      Alert.alert('Update the app', 'Calls need the latest version of the app. Install the update, then try again.')
      return false
    }
    if (!(await microphoneAllowed(MIC_PROMPT))) {
      Alert.alert('Microphone blocked', 'Allow the microphone for this app in Settings to make and take calls.')
      return false
    }
    return true
  }, [])

  /* ── Calling out ─────────────────────────────────────────────────────── */

  const placeCall = useCallback(async ({ conversationId, peerName, peerRole }: CallRequest) => {
    if (activeRef.current && activeRef.current.phase !== 'ended') return
    if (!(await canTalk())) return

    const attempt = ++attemptRef.current
    callIdRef.current = null
    const draft: ActiveCall = {
      direction: 'out', peerName, peerRole, phase: 'placing',
      muted: false, startedAt: null, ringLeft: null, note: null,
    }
    activeRef.current = draft
    setActive(draft)

    let callId: string | null = null
    try {
      const started = await startChatCall(conversationId)
      callId = started.call.call_id
      if (attempt !== attemptRef.current) { void endChatCall(callId); return }
      callIdRef.current = callId
      setActive((a) => a && { ...a, peerName: started.call.callee_name, peerRole: started.call.callee_role })

      const room = await joinRoom(started.url, started.token)
      if (attempt !== attemptRef.current) return

      setActive((a) => (a && a.phase === 'placing' ? { ...a, phase: 'ringing', ringLeft: started.ring_seconds } : a))
      // They may have answered while we were still connecting.
      if (room.remoteParticipants.size > 0) {
        setActive((a) => (a && a.phase !== 'ended' ? { ...a, phase: 'live', startedAt: Date.now(), ringLeft: null } : a))
      }
    } catch (e: any) {
      if (attempt !== attemptRef.current) return
      if (callId) {
        console.warn('[chat call] failed at', e?.message)
        void endChatCall(callId, 'failed', e?.message)
      }
      finishLocal(callId ? 'The call could not connect. Check your signal and try again.' : errorMessage(e, 'The call could not be placed.'))
    }
  }, [canTalk, joinRoom, finishLocal])

  // Ring countdown → no answer.
  useEffect(() => {
    if (!active || active.direction !== 'out' || active.phase !== 'ringing' || active.ringLeft == null) return
    if (active.ringLeft <= 0) {
      const id = callIdRef.current
      if (id) void endChatCall(id, 'no_answer')
      finishLocal('No answer.')
      return
    }
    const t = setTimeout(() => setActive((a) => (a && a.ringLeft != null ? { ...a, ringLeft: a.ringLeft - 1 } : a)), 1000)
    return () => clearTimeout(t)
  }, [active, finishLocal])

  /* ── Calls coming in ─────────────────────────────────────────────────── */

  const answer = useCallback(async (call: ChatCallView) => {
    if (answering || (activeRef.current && activeRef.current.phase !== 'ended')) return
    setAnswering(call.call_id)
    try {
      if (!(await canTalk())) return
      const attempt = ++attemptRef.current

      let joined = false
      try {
        const { url, token, call: fresh } = await answerChatCall(call.call_id)
        joined = true
        dropRinging(call.call_id)
        callIdRef.current = call.call_id
        setActive({
          direction: 'in', peerName: fresh?.caller_name ?? call.caller_name, peerRole: fresh?.caller_role ?? call.caller_role,
          phase: 'connecting', muted: false, startedAt: null, ringLeft: null, note: null,
        })

        await joinRoom(url, token)
        if (attempt !== attemptRef.current) return
        setActive((a) => (a && a.phase === 'connecting' ? { ...a, phase: 'live', startedAt: Date.now() } : a))
      } catch (e: any) {
        dropRinging(call.call_id)
        if (attempt !== attemptRef.current) return
        if (joined) void endChatCall(call.call_id, 'failed', e?.message)
        attemptRef.current += 1
        teardown()
        setActive({
          direction: 'in', peerName: call.caller_name, peerRole: call.caller_role,
          phase: 'ended', muted: false, startedAt: null, ringLeft: null,
          note: joined ? 'The call could not connect. Check your signal.' : errorMessage(e, 'The call could not be answered.'),
        })
      }
    } finally {
      setAnswering(null)
    }
  }, [answering, canTalk, dropRinging, joinRoom, teardown])

  const decline = useCallback((call: ChatCallView) => {
    dismissed.current.add(call.call_id)
    dropRinging(call.call_id)
    void declineChatCall(call.call_id)
  }, [dropRinging])

  /* ── On the call ─────────────────────────────────────────────────────── */

  const hangUp = useCallback(() => {
    const a  = activeRef.current
    const id = callIdRef.current
    if (id) void endChatCall(id)
    finishLocal(a?.phase === 'live' ? 'You ended the call.' : 'Call cancelled.')
  }, [finishLocal])

  const toggleMute = useCallback(async () => {
    const room = roomRef.current
    const a    = activeRef.current
    if (!room || !a) return
    try {
      await room.localParticipant.setMicrophoneEnabled(a.muted)
      setActive((cur) => cur && { ...cur, muted: !a.muted })
    } catch {}
  }, [])

  const closeSheet = useCallback(() => {
    callIdRef.current = null
    setActive(null)
  }, [])

  useEffect(() => {
    if (active?.phase !== 'ended') return
    const t = setTimeout(closeSheet, ENDED_LINGER_MS)
    return () => clearTimeout(t)
  }, [active?.phase, closeSheet])

  /* ── Wiring ──────────────────────────────────────────────────────────── */

  const refreshRinging = useCallback(() => {
    ringingChatCalls().then((calls) => calls.forEach(addRinging)).catch(() => {})
  }, [addRinging])

  useEffect(() => {
    if (!userId) return

    refreshRinging()

    const channelName   = `chat-calls:user:${userId}`
    const realtimeTopic = `realtime:${channelName}`
    supabase
      .getChannels()
      .filter((c) => c.topic === realtimeTopic)
      .forEach((c) => supabase.removeChannel(c))

    const idOf = (msg: { [key: string]: any }) => (msg.payload?.call_id as string | undefined) ?? ''

    const channel = supabase
      .channel(channelName)
      .on('broadcast', { event: 'chat_call_incoming' }, (msg) => addRinging(msg.payload as ChatCallView))
      // Answered on another device: stop ringing here.
      .on('broadcast', { event: 'chat_call_answered' }, (msg) => dropRinging(idOf(msg)))
      .on('broadcast', { event: 'chat_call_declined' }, (msg) => {
        const id = idOf(msg)
        dropRinging(id)
        if (id && id === callIdRef.current && activeRef.current?.direction === 'out') {
          finishLocal(`${activeRef.current.peerName} declined the call.`)
        }
      })
      .on('broadcast', { event: 'chat_call_closed' }, (msg) => {
        const id = idOf(msg)
        dropRinging(id)
        const a = activeRef.current
        if (id && id === callIdRef.current && a && a.phase !== 'ended') {
          finishLocal(a.phase === 'live' ? `${a.peerName} hung up.` : 'The call ended.')
        }
      })
      .subscribe()

    // A call that rang while the app was in the background (the push brought
    // the driver back) shows its ringer now.
    const sub = AppState.addEventListener('change', (state) => { if (state === 'active') refreshRinging() })

    return () => {
      supabase.removeChannel(channel)
      sub.remove()
    }
  }, [userId, addRinging, dropRinging, finishLocal, refreshRinging])

  // Drop ringers that outlived any real ring, in case a close event was missed.
  useEffect(() => {
    if (ringing.length === 0) return
    const timer = setInterval(() => {
      const cutoff = Date.now() - RING_MAX_MS
      setRinging((list) => list.filter((c) => Date.parse(c.created_at) > cutoff))
    }, 5000)
    return () => clearInterval(timer)
  }, [ringing.length])

  useEffect(() => {
    setPlaceCall((req) => { void placeCall(req) })
    return () => setPlaceCall(null)
  }, [placeCall, setPlaceCall])

  const busy       = !!active && active.phase !== 'ended'
  const ringingNow = !busy ? ringing[0] ?? null : null

  useEffect(() => { setInCall(busy || ringing.length > 0) }, [busy, ringing.length, setInCall])

  // Vibrate while a call rings in: there is no ringtone file in the app.
  useEffect(() => {
    if (!ringingNow) return
    Vibration.vibrate([0, 900, 1100], true)
    return () => Vibration.cancel()
  }, [ringingNow?.call_id])

  // Call timer.
  useEffect(() => {
    if (active?.phase !== 'live') return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [active?.phase])

  if (ringingNow) {
    return (
      <CallSheet
        name={ringingNow.caller_name}
        role={ringingNow.caller_role}
        status="Incoming call"
      >
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <View style={{ flex: 1 }}>
            <Button label="Decline" color={D.red} bg={D.redBg} icon={<PhoneOff size={16} color={D.red} />}
              disabled={!!answering} onPress={() => decline(ringingNow)} />
          </View>
          <View style={{ flex: 1 }}>
            <Button
              label={answering === ringingNow.call_id ? 'Connecting…' : 'Answer'}
              color={D.green} bg={D.greenBg} icon={<Phone size={16} color={D.green} />}
              disabled={!!answering} onPress={() => void answer(ringingNow)}
            />
          </View>
        </View>
      </CallSheet>
    )
  }

  if (!active) return null

  const elapsedS = active.startedAt ? Math.max(0, Math.floor((now - active.startedAt) / 1000)) : 0
  const status =
    active.phase === 'placing'      ? 'Calling…'
    : active.phase === 'ringing'    ? `Ringing…${active.ringLeft != null ? ` ${active.ringLeft}s` : ''}`
    : active.phase === 'connecting' ? 'Connecting…'
    : active.phase === 'live'       ? `${Math.floor(elapsedS / 60)}:${String(elapsedS % 60).padStart(2, '0')}`
    : 'Call ended'

  return (
    <CallSheet name={active.peerName} role={active.peerRole} status={status} note={active.note}>
      {(active.phase === 'placing' || active.phase === 'connecting') && <ActivityIndicator color={D.cyan} />}
      {active.phase === 'ended' ? (
        <Button label="Close" color={D.faint} onPress={closeSheet} />
      ) : (
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <View style={{ flex: 1 }}>
            <Button
              label={active.muted ? 'Unmute' : 'Mute'} color={D.white}
              icon={active.muted ? <MicOff size={16} color={D.white} /> : <Mic size={16} color={D.white} />}
              disabled={active.phase !== 'live' && active.phase !== 'ringing'}
              onPress={() => void toggleMute()}
            />
          </View>
          <View style={{ flex: 1 }}>
            <Button label={active.phase === 'live' ? 'Hang up' : 'Cancel'} color={D.red} bg={D.redBg}
              icon={<PhoneOff size={16} color={D.red} />} onPress={hangUp} />
          </View>
        </View>
      )}
    </CallSheet>
  )
}

function CallSheet({
  name, role, status, note, children,
}: { name: string; role: string; status: string; note?: string | null; children: React.ReactNode }) {
  return (
    <Modal visible transparent animationType="fade" onRequestClose={() => {}}>
      <View style={{ flex: 1, backgroundColor: D.overlay, alignItems: 'center', justifyContent: 'center', padding: 20 }}>
        <View style={{
          width: '100%', maxWidth: 340, backgroundColor: D.card, alignItems: 'stretch',
          borderWidth: 0.5, borderColor: D.cyan, borderRadius: 15, padding: 18, gap: 12,
        }}>
          <View style={{ alignItems: 'center', gap: 6 }}>
            <View style={{
              width: 72, height: 72, borderRadius: 36, borderWidth: 1, borderColor: D.line,
              backgroundColor: '#1a1a1a', alignItems: 'center', justifyContent: 'center',
            }}>
              <Text style={{ color: D.white, fontSize: 22, fontFamily: FONTS.alegreyaSans.bold }}>{initialsOf(name)}</Text>
            </View>
            <Text style={{ color: D.white, fontSize: 18, textAlign: 'center', fontFamily: FONTS.alegreyaSans.bold }}>{name}</Text>
            {role ? (
              <Text style={{ color: D.faint, fontSize: 13, fontFamily: FONTS.alegreyaSans.regular }}>{roleLabel(role)}</Text>
            ) : null}
            <Text style={{ color: D.cyan, fontSize: 14, fontFamily: FONTS.alegreyaSans.medium }}>{status}</Text>
            {note ? (
              <Text style={{ color: D.orange, fontSize: 13, textAlign: 'center', fontFamily: FONTS.alegreyaSans.regular }}>{note}</Text>
            ) : null}
          </View>
          {children}
        </View>
      </View>
    </Modal>
  )
}

function Button({
  label, color, bg, icon, disabled, onPress,
}: { label: string; color: string; bg?: string; icon?: React.ReactNode; disabled?: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.8}
      accessibilityRole="button"
      style={{
        flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
        paddingVertical: 12, borderRadius: 10, borderWidth: 1,
        borderColor: bg ? color : D.line,
        backgroundColor: bg ?? 'transparent',
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {icon}
      <Text style={{ color, fontSize: 14, fontFamily: FONTS.alegreyaSans.bold }}>{label}</Text>
    </TouchableOpacity>
  )
}
