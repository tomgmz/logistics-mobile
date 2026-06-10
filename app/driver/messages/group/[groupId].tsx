import React, { useState, useEffect, useCallback, useRef } from 'react'
import {
  View, Text, FlatList, TouchableOpacity, TextInput,
  StyleSheet, ActivityIndicator,
  Animated, Modal, Keyboard,
} from 'react-native'
import { useLocalSearchParams, useRouter, useFocusEffect } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { ArrowLeft, Send, CornerUpLeft, X, Users, Check, X as XIcon, Smile } from 'lucide-react-native'
import Reanimated, { useSharedValue, useAnimatedStyle, withSpring, runOnJS } from 'react-native-reanimated'
import { useKeyboardHandler } from 'react-native-keyboard-controller'
import { GestureDetector, Gesture } from 'react-native-gesture-handler'
import { useAuthStore } from '../../../../lib/store/auth.store'
import { messagingApi } from '../../../../lib/api/messaging.api'
import { useMessagingRealtime } from '../../../../hooks/useMessagingRealtime'
import { setActiveChat } from '../../../../lib/push'
import EmojiSheet from '../../../../components/messaging/EmojiSheet'
import type { GroupMessageRaw, ReactionTogglePayload, GroupReadReceiptPayload } from '../../../../types/messaging.types'

const C = {
  bg:       '#0a0a0a',
  raised:   '#1a1a1a',
  elevated: '#1e1e1e',
  border:   '#2a2a2a',
  cyan:     '#4df9ed',
  cyanText: '#0a0a0a',
  white:    '#ffffff',
  muted:    '#818181',
  dimText:  'rgba(255,255,255,0.55)',
  amber:    '#f59e0b',
  overlay:  'rgba(0,0,0,0.6)',
}

const QUICK_EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '😡']
const PHT = 'Asia/Manila'

function parsePHT(iso: string): Date {
  const utc = iso.endsWith('Z') || iso.includes('+') ? iso : `${iso}Z`
  return new Date(utc)
}

function formatMsgTime(iso: string): string {
  return parsePHT(iso).toLocaleTimeString('en-PH', {
    hour: 'numeric', minute: '2-digit', hour12: true, timeZone: PHT,
  })
}

function formatDateSeparator(iso: string): string {
  const d      = parsePHT(iso)
  const now    = new Date()
  const dPHT   = new Date(d.toLocaleString('en-US', { timeZone: PHT }))
  const nowPHT = new Date(now.toLocaleString('en-US', { timeZone: PHT }))
  const dif = Math.floor((nowPHT.setHours(0,0,0,0) - dPHT.setHours(0,0,0,0)) / 86_400_000)
  if (dif === 0) return 'Today'
  if (dif === 1) return 'Yesterday'
  return d.toLocaleDateString('en-PH', { month: 'long', day: 'numeric', year: 'numeric', timeZone: PHT })
}

function dayKey(iso: string): string {
  return parsePHT(iso).toLocaleDateString('en-CA', { timeZone: PHT })
}

interface GMsg {
  id:       string
  group_id: string
  sender_id:string
  content:  string
  sent_at:  string
  reply_to: { message_id: string; content: string; sender_id: string } | null
  reactions:{ emoji: string; user_id: string }[]
}

interface ReactionGroup { emoji: string; count: number; reacted: boolean }

function groupReactions(reactions: { emoji: string; user_id: string }[], userId: string): ReactionGroup[] {
  const map = new Map<string, { count: number; reacted: boolean }>()
  for (const r of reactions) {
    const cur = map.get(r.emoji) ?? { count: 0, reacted: false }
    map.set(r.emoji, { count: cur.count + 1, reacted: cur.reacted || r.user_id === userId })
  }
  return [...map.entries()].map(([emoji, v]) => ({ emoji, ...v }))
}

function TypingDots() {
  const anim = useRef([new Animated.Value(0), new Animated.Value(0), new Animated.Value(0)]).current
  useEffect(() => {
    const loop = Animated.loop(Animated.stagger(150, anim.map(a =>
      Animated.sequence([
        Animated.timing(a, { toValue: -4, duration: 300, useNativeDriver: true }),
        Animated.timing(a, { toValue:  0, duration: 300, useNativeDriver: true }),
      ])
    )))
    loop.start()
    return () => loop.stop()
  }, [])
  return (
    <View style={tdS.wrap}>
      {anim.map((a, i) => <Animated.View key={i} style={[tdS.dot, { transform: [{ translateY: a }] }]} />)}
    </View>
  )
}
const tdS = StyleSheet.create({
  wrap: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingVertical: 2 },
  dot:  { width: 6, height: 6, borderRadius: 3, backgroundColor: 'rgba(77,249,237,0.5)' },
})

function ReactionStrip({ reactions, currentUserId, isMine, onToggle }: {
  reactions:     { emoji: string; user_id: string }[]
  currentUserId: string
  isMine:        boolean
  onToggle:      (emoji: string) => void
}) {
  const grouped = groupReactions(reactions, currentUserId)
  if (!grouped.length) return null
  return (
    <View style={[rS.wrap, isMine ? rS.wrapMine : rS.wrapTheirs]}>
      {grouped.map(r => (
        <TouchableOpacity key={r.emoji} onPress={() => onToggle(r.emoji)} activeOpacity={0.75} style={[rS.badge, r.reacted && rS.badgeActive]}>
          <Text style={rS.emoji}>{r.emoji}</Text>
          {r.count > 1 && <Text style={[rS.count, r.reacted && rS.countActive]}>{r.count}</Text>}
        </TouchableOpacity>
      ))}
    </View>
  )
}
const rS = StyleSheet.create({
  wrap:        { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 4 },
  wrapMine:    { justifyContent: 'flex-end' },
  wrapTheirs:  { justifyContent: 'flex-start' },
  badge:       { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.07)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },
  badgeActive: { backgroundColor: 'rgba(77,249,237,0.12)', borderColor: 'rgba(77,249,237,0.35)' },
  emoji:       { fontSize: 14 },
  count:       { color: C.muted, fontSize: 11, fontWeight: '600' },
  countActive: { color: C.cyan },
})

function EmojiPicker({ visible, onClose, onPick }: { visible: boolean; onClose: () => void; onPick: (e: string) => void }) {
  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={onClose}>
      <TouchableOpacity style={epS.backdrop} activeOpacity={1} onPress={onClose}>
        <View style={epS.sheet}>
          <Text style={epS.label}>React</Text>
          <View style={epS.row}>
            {QUICK_EMOJIS.map(e => (
              <TouchableOpacity key={e} onPress={() => { onPick(e); onClose() }} activeOpacity={0.7} style={epS.emojiBtn}>
                <Text style={epS.emoji}>{e}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      </TouchableOpacity>
    </Modal>
  )
}
const epS = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: C.overlay, justifyContent: 'flex-end' },
  sheet:    { backgroundColor: '#181818', borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingHorizontal: 24, paddingTop: 16, paddingBottom: 32, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.07)' },
  label:    { color: C.muted, fontSize: 11, fontWeight: '600', letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 14, textAlign: 'center' },
  row:      { flexDirection: 'row', justifyContent: 'space-between' },
  emojiBtn: { width: 48, height: 48, borderRadius: 24, backgroundColor: 'rgba(255,255,255,0.06)', alignItems: 'center', justifyContent: 'center' },
  emoji:    { fontSize: 24 },
})

function GroupBubble({ msg, isMine, senderName, currentUserId, seenBy, onLongPress, onReact, memberName, onReply }: {
  msg:           GMsg
  isMine:        boolean
  senderName:    string
  memberName:    (uid: string) => string
  currentUserId: string
  seenBy:        { user_id: string; first_name: string }[]
  onLongPress:   (id: string) => void
  onReact:       (id: string, emoji: string) => void
  onReply:       (m: GMsg) => void
}) {
  const hasReply   = !!(msg.reply_to?.message_id)
  const translateX = useSharedValue(0)
  const triggered  = useSharedValue(false)
  const THRESHOLD  = 65

  const onTrigger = () => onReply(msg)

  const panGesture = Gesture.Pan()
    .activeOffsetX(isMine ? [-10, 999] : [-999, 10])
    .failOffsetY([-8, 8])
    .onUpdate((e) => {
      if (isMine && e.translationX < 0) {
        translateX.value = Math.max(e.translationX, -THRESHOLD)
        if (translateX.value <= -THRESHOLD && !triggered.value) {
          triggered.value = true
          runOnJS(onTrigger)()
        }
      } else if (!isMine && e.translationX > 0) {
        translateX.value = Math.min(e.translationX, THRESHOLD)
        if (translateX.value >= THRESHOLD && !triggered.value) {
          triggered.value = true
          runOnJS(onTrigger)()
        }
      }
    })
    .onEnd(() => {
      triggered.value = false
      translateX.value = withSpring(0, { damping: 20, stiffness: 300 })
    })

  const bubbleAnim = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
  }))

  const iconAnim = useAnimatedStyle(() => {
    const progress = isMine
      ? Math.min(Math.abs(translateX.value) / THRESHOLD, 1)
      : Math.min(translateX.value / THRESHOLD, 1)
    return {
      opacity: progress,
      transform: [{ scale: 0.6 + 0.4 * progress }],
    }
  })

  return (
    <GestureDetector gesture={panGesture}>
      <View style={[bS.msgRow, isMine ? bS.msgRowMine : bS.msgRowTheirs]}>
        {/* Reply icon — left of bubble for mine, fades in as bubble slides left */}
        {isMine && (
          <Reanimated.View style={[bS.swipeIcon, iconAnim]}>
            <CornerUpLeft size={16} color="rgba(255,255,255,0.5)" />
          </Reanimated.View>
        )}

        <Reanimated.View style={[bS.wrap, isMine ? bS.wrapMine : bS.wrapTheirs, bubbleAnim]}>
          {!isMine && <Text style={bS.senderName}>{senderName}</Text>}

          {/* FB Messenger–style reply */}
          {hasReply && (
            <>
              <View style={[bS.attribution, isMine ? bS.attributionMine : bS.attributionTheirs]}>
                <CornerUpLeft size={11} color="rgba(255,255,255,0.35)" />
                <Text style={bS.attributionText}>
                  {isMine
                    ? `You replied to ${memberName(msg.reply_to!.sender_id)}`
                    : `${senderName} replied to ${memberName(msg.reply_to!.sender_id)}`}
                </Text>
              </View>
              <View style={[bS.quoteCard, isMine ? bS.quoteCardMine : bS.quoteCardTheirs]}>
                <Text style={bS.quoteText} numberOfLines={3}>{msg.reply_to!.content}</Text>
              </View>
            </>
          )}

          {/* Actual message bubble */}
          <TouchableOpacity
            onLongPress={() => onLongPress(msg.id)}
            onPress={() => {}}
            activeOpacity={0.85}
            delayLongPress={350}
            style={[bS.bubble, isMine ? bS.bubbleMine : bS.bubbleTheirs]}
          >
            <Text style={isMine ? bS.textMine : bS.textTheirs}>{msg.content}</Text>
          </TouchableOpacity>

          <ReactionStrip
            reactions={msg.reactions}
            currentUserId={currentUserId}
            isMine={isMine}
            onToggle={(emoji) => onReact(msg.id, emoji)}
          />

          <Text style={[bS.time, isMine && { alignSelf: 'flex-end' }]}>{formatMsgTime(msg.sent_at)}</Text>

          {isMine && seenBy.length > 0 && (
            <View style={bS.seenRow}>
              {seenBy.slice(0, 3).map(s => (
                <View key={s.user_id} style={bS.seenAvatar}>
                  <Text style={bS.seenAvatarText}>{s.first_name[0]?.toUpperCase() ?? '?'}</Text>
                </View>
              ))}
              {seenBy.length > 3 && <Text style={bS.seenOverflow}>+{seenBy.length - 3}</Text>}
            </View>
          )}
        </Reanimated.View>

        {/* Reply icon — right of bubble for theirs, fades in as bubble slides right */}
        {!isMine && (
          <Reanimated.View style={[bS.swipeIcon, iconAnim]}>
            <CornerUpLeft size={16} color="rgba(255,255,255,0.5)" />
          </Reanimated.View>
        )}
      </View>
    </GestureDetector>
  )
}
const bS = StyleSheet.create({
  msgRow:       { flexDirection: 'row', alignItems: 'flex-end', gap: 4, marginBottom: 2 },
  msgRowMine:   { justifyContent: 'flex-end' },
  msgRowTheirs: { justifyContent: 'flex-start' },
  swipeIcon:    { width: 28, height: 28, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },

  wrap:         { maxWidth: '80%' },
  wrapMine:     { alignItems: 'flex-end' },
  wrapTheirs:   { alignItems: 'flex-start' },
  senderName:   { color: C.cyan, fontSize: 11, fontWeight: '600', marginBottom: 2, marginLeft: 2 },

  attribution:      { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 4 },
  attributionMine:  { alignSelf: 'flex-end' },
  attributionTheirs:{ alignSelf: 'flex-start' },
  attributionText:  { color: 'rgba(255,255,255,0.35)', fontSize: 11 },

  quoteCard:       { borderRadius: 14, paddingHorizontal: 12, paddingVertical: 8, marginBottom: 3, maxWidth: '100%', borderWidth: 1 },
  quoteCardMine:   { backgroundColor: 'rgba(0,0,0,0.15)', borderColor: 'rgba(0,0,0,0.12)', alignSelf: 'flex-end' },
  quoteCardTheirs: { backgroundColor: 'rgba(255,255,255,0.08)', borderColor: 'rgba(255,255,255,0.1)', alignSelf: 'flex-start' },
  quoteText:       { color: 'rgba(255,255,255,0.5)', fontSize: 13, lineHeight: 18 },

  // Message bubble
  bubble:       { borderRadius: 18, paddingHorizontal: 14, paddingVertical: 9 },
  bubbleMine:   { backgroundColor: C.cyan, borderBottomRightRadius: 4 },
  bubbleTheirs: { backgroundColor: C.raised, borderWidth: 1, borderColor: C.border, borderBottomLeftRadius: 4 },
  textMine:     { color: C.cyanText, fontSize: 14, lineHeight: 20 },
  textTheirs:   { color: C.white,    fontSize: 14, lineHeight: 20 },

  time: { color: C.muted, fontSize: 10, marginTop: 3, marginHorizontal: 2 },

  seenRow:        { flexDirection: 'row', alignItems: 'center', gap: 2, marginTop: 3, alignSelf: 'flex-end' },
  seenAvatar:     { width: 14, height: 14, borderRadius: 7, backgroundColor: C.raised, borderWidth: 1, borderColor: 'rgba(255,255,255,0.25)', alignItems: 'center', justifyContent: 'center' },
  seenAvatarText: { color: 'rgba(255,255,255,0.7)', fontSize: 7, fontWeight: '700' },
  seenOverflow:   { color: 'rgba(255,255,255,0.4)', fontSize: 9, marginLeft: 1 },
})

function InviteBanner({ groupId, groupName, onResponded }: { groupId: string; groupName: string; onResponded: (a: boolean) => void }) {
  const [loading, setLoading] = useState(false)
  const respond = async (accept: boolean) => {
    setLoading(true)
    try { await messagingApi.respondToGroupInvite(groupId, accept); onResponded(accept) }
    catch { /* silent */ }
    finally { setLoading(false) }
  }
  return (
    <View style={invS.banner}>
      <Users size={18} color={C.amber} />
      <View style={{ flex: 1 }}>
        <Text style={invS.title}>Group Invite</Text>
        <Text style={invS.sub}>You've been invited to <Text style={{ color: C.white }}>{groupName}</Text></Text>
      </View>
      <View style={invS.btns}>
        <TouchableOpacity onPress={() => respond(false)} disabled={loading} style={[invS.btn, invS.decline]}>
          <XIcon size={14} color="#f87171" />
        </TouchableOpacity>
        <TouchableOpacity onPress={() => respond(true)} disabled={loading} style={[invS.btn, invS.accept]}>
          {loading ? <ActivityIndicator size="small" color={C.cyanText} /> : <Check size={14} color={C.cyanText} />}
        </TouchableOpacity>
      </View>
    </View>
  )
}
const invS = StyleSheet.create({
  banner:  { flexDirection: 'row', alignItems: 'center', gap: 10, marginHorizontal: 12, marginBottom: 10, padding: 12, borderRadius: 14, backgroundColor: 'rgba(245,158,11,0.08)', borderWidth: 1, borderColor: 'rgba(245,158,11,0.25)' },
  title:   { color: C.amber, fontSize: 12, fontWeight: '700' },
  sub:     { color: C.muted, fontSize: 11, marginTop: 1 },
  btns:    { flexDirection: 'row', gap: 6 },
  btn:     { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  decline: { backgroundColor: 'rgba(248,113,113,0.12)', borderWidth: 1, borderColor: 'rgba(248,113,113,0.25)' },
  accept:  { backgroundColor: C.cyan },
})

export default function GroupChatScreen() {
  const router        = useRouter()
  const insets        = useSafeAreaInsets()
  const { user }      = useAuthStore()
  const currentUserId = user?.user_id ?? ''

  const { groupId, groupName, myStatus: initialStatus } = useLocalSearchParams<{
    groupId: string; groupName: string; myStatus: string
  }>()

  // Suppress push notifications for this group while it is on screen.
  useFocusEffect(
    useCallback(() => {
      setActiveChat(groupId ?? null)
      return () => setActiveChat(null)
    }, [groupId])
  )

  const [messages,    setMessages]    = useState<GMsg[]>([])
  const [loading,     setLoading]     = useState(true)
  const [sending,     setSending]     = useState(false)
  const [text,        setText]        = useState('')
  const [replyTo,     setReplyTo]     = useState<GMsg | null>(null)
  const [myStatus,    setMyStatus]    = useState(initialStatus ?? 'accepted')
  const [typingUsers, setTyping]      = useState<string[]>([])
  const [pickerMsgId, setPickerMsgId] = useState<string | null>(null)
  const [emojiOpen,   setEmojiOpen]   = useState(false)
  const [membersMap,  setMembersMap]  = useState<Record<string, string>>({})
  const [members,     setMembers]     = useState<{ user_id: string; first_name: string; status: string; last_read_at: string | null }[]>([])

  const listRef      = useRef<FlatList>(null)
  const pendingIds   = useRef<Set<string>>(new Set())
  const typingTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({})
  const meTypingRef   = useRef(false)
  const meTypingTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const scrollToEnd = useCallback(() => {
    listRef.current?.scrollToEnd({ animated: true })
  }, [])

  const kbHeight = useSharedValue(0)
  useKeyboardHandler({
    onMove: (e) => {
      'worklet'
      kbHeight.value = e.height
    },
    onEnd: (e) => {
      'worklet'
      kbHeight.value = e.height
      if (e.height > 0) runOnJS(scrollToEnd)()
    },
  }, [scrollToEnd])

  const kbSpacerStyle = useAnimatedStyle(() => ({
    height: Math.max(kbHeight.value, insets.bottom),
  }))

  const memberName = useCallback((uid: string): string => {
    if (uid === currentUserId) return 'You'
    return membersMap[uid] ?? 'Member'
  }, [membersMap, currentUserId])

  const seenByFor = useCallback((msg: GMsg, isMine: boolean): { user_id: string; first_name: string }[] => {
    if (!isMine || msg.id.startsWith('optimistic-')) return []
    const sentMs = parsePHT(msg.sent_at).getTime()
    return members.filter(m =>
      m.status === 'accepted' &&
      m.user_id !== currentUserId &&
      m.last_read_at !== null &&
      parsePHT(m.last_read_at).getTime() >= sentMs
    )
  }, [members, currentUserId])

  const toItem = useCallback((raw: GroupMessageRaw): GMsg => ({
    id:       raw.message_id,
    group_id: raw.group_id,
    sender_id:raw.sender_id,
    content:  raw.content,
    sent_at:  raw.sent_at,
    reply_to: raw.reply_to,
    reactions:raw.reactions ?? [],
  }), [])

  const fetchMessages = useCallback(async () => {
    if (!groupId || myStatus !== 'accepted') return
    try {
      const [rawMsgs, rawGroups] = await Promise.all([
        messagingApi.getGroupMessages(groupId, { limit: 60 }),
        messagingApi.getGroups(),
      ])
      setMessages(rawMsgs.map(toItem))
      const found = rawGroups.find(g => g.group_id === groupId)
      if (found) {
        const map: Record<string, string> = {}
        for (const m of found.members) {
          map[m.user.user_id] = `${m.user.first_name ?? ''} ${m.user.last_name ?? ''}`.trim()
        }
        setMembersMap(map)
        setMembers(found.members.map(m => ({
          user_id:      m.user.user_id,
          first_name:   m.user.first_name ?? '',
          status:       m.status,
          last_read_at: m.last_read_at ?? null,
        })))
      }
    } catch { /* silent */ }
    finally { setLoading(false) }
  }, [groupId, myStatus, toItem])

  useEffect(() => { fetchMessages() }, [fetchMessages])

  useEffect(() => {
    if (myStatus !== 'accepted' || !groupId) return
    messagingApi.markGroupRead(groupId).catch(() => {})
  }, [groupId, myStatus])


  const applyReaction = useCallback((payload: ReactionTogglePayload) => {
    setMessages(prev => prev.map(m => {
      if (m.id !== payload.message_id) return m
      const base = m.reactions.filter(r => r.user_id !== payload.user_id)
      return { ...m, reactions: payload.action === 'added' ? [...base, { emoji: payload.emoji, user_id: payload.user_id }] : base }
    }))
  }, [])

  const { broadcastTyping } = useMessagingRealtime({
    currentUserId,
    conversationId: `group:${groupId}`,
    onGroupMessage: (raw) => {
      if (raw.group_id !== groupId) return
      const inc = toItem(raw)
      setMessages(prev => {
        const match = [...pendingIds.current].find(id => prev.some(m => m.id === id && m.content === inc.content))
        if (match) { pendingIds.current.delete(match); return prev.map(m => m.id === match ? inc : m) }
        if (prev.some(m => m.id === inc.id)) return prev
        if (raw.sender_id !== currentUserId) messagingApi.markGroupRead(groupId).catch(() => {})
        return [...prev, inc]
      })
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 80)
    },
    onReactionToggle: applyReaction,
    onGroupReadReceipt: ({ user_id, read_at }: GroupReadReceiptPayload) => {
      setMembers(prev => prev.map(m => m.user_id === user_id ? { ...m, last_read_at: read_at } : m))
    },
    onTyping: (uid, isTypingNow) => {
      if (uid === currentUserId) return
      if (typingTimers.current[uid]) clearTimeout(typingTimers.current[uid])
      if (isTypingNow) {
        setTyping(p => p.includes(uid) ? p : [...p, uid])
        typingTimers.current[uid] = setTimeout(() => { setTyping(p => p.filter(u => u !== uid)); delete typingTimers.current[uid] }, 3000)
      } else {
        setTyping(p => p.filter(u => u !== uid))
      }
    },
  })

  useEffect(() => {
    if (!loading && messages.length > 0) setTimeout(() => listRef.current?.scrollToEnd({ animated: false }), 100)
  }, [loading])

  const handleSend = async () => {
    const body = text.trim()
    if (!body || !groupId || myStatus !== 'accepted') return

    const oid = `optimistic-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    pendingIds.current.add(oid)
    setMessages(prev => [...prev, {
      id: oid, group_id: groupId, sender_id: currentUserId, content: body,
      sent_at: new Date().toISOString(),
      reply_to: replyTo ? { message_id: replyTo.id, content: replyTo.content, sender_id: replyTo.sender_id } : null,
      reactions: [],
    }])
    setText('')
    setReplyTo(null)
    if (meTypingTimer.current) clearTimeout(meTypingTimer.current)
    stopMeTyping()
    setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 80)

    try {
      setSending(true)
      const saved = await messagingApi.sendGroupMessage(groupId, { content: body, reply_to_message_id: replyTo?.id })
      setMessages(prev => prev.map(m => m.id === oid ? toItem(saved) : m))
      pendingIds.current.delete(oid)
    } catch {
      pendingIds.current.delete(oid)
      setMessages(prev => prev.filter(m => m.id !== oid))
    } finally { setSending(false) }
  }

  const handleReact = async (messageId: string, emoji: string) => {
    setMessages(prev => prev.map(m => {
      if (m.id !== messageId) return m
      const base    = m.reactions.filter(r => r.user_id !== currentUserId)
      const already = m.reactions.find(r => r.user_id === currentUserId)
      return { ...m, reactions: already?.emoji === emoji ? base : [...base, { emoji, user_id: currentUserId }] }
    }))
    try { await messagingApi.reactToGroupMessage(groupId, messageId, emoji) }
    catch { fetchMessages() }
  }

  const stopMeTyping = useCallback(() => {
    if (!meTypingRef.current) return
    meTypingRef.current = false
    broadcastTyping(false)
  }, [broadcastTyping])

  const handleChangeText = (val: string) => {
    setText(val)
    if (val.trim() && !meTypingRef.current) { meTypingRef.current = true; broadcastTyping(true) }
    else if (!val.trim()) stopMeTyping()
    if (meTypingTimer.current) clearTimeout(meTypingTimer.current)
    meTypingTimer.current = setTimeout(stopMeTyping, 2500)
  }

  type Entry =
    | { type: 'date'; key: string; label: string }
    | { type: 'msg';  key: string; msg: GMsg }

  const entries: Entry[] = []
  let lastDay = ''
  for (const m of messages) {
    const d = dayKey(m.sent_at)
    if (d !== lastDay) { entries.push({ type: 'date', key: `sep-${d}`, label: formatDateSeparator(m.sent_at) }); lastDay = d }
    entries.push({ type: 'msg', key: m.id, msg: m })
  }

  const name = groupName ?? 'Group'
  const typingLabel = typingUsers.length === 1 ? 'Someone is typing…' : typingUsers.length > 1 ? 'Several people are typing…' : null

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} activeOpacity={0.7} style={styles.backBtn}>
          <ArrowLeft size={20} color={C.white} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <View style={styles.headerAvatar}>
            <Users size={16} color={C.muted} />
          </View>
          <View>
            <Text style={styles.headerName} numberOfLines={1}>{name}</Text>
            <Text style={[styles.headerStatus, typingUsers.length > 0 && styles.headerStatusTyping]}>
              {typingLabel ?? (myStatus === 'pending' ? 'Invite pending' : 'Group')}
            </Text>
          </View>
        </View>
      </View>

        {myStatus === 'pending' && (
          <InviteBanner
            groupId={groupId ?? ''}
            groupName={name}
            onResponded={(accepted) => {
              setMyStatus(accepted ? 'accepted' : 'declined')
              if (accepted) fetchMessages()
              else router.back()
            }}
          />
        )}

        {loading && myStatus === 'accepted' ? (
          <View style={styles.center}><ActivityIndicator size="small" color={C.cyan} /></View>
        ) : myStatus === 'declined' ? (
          <View style={styles.center}><Text style={styles.declinedText}>You declined this group invite.</Text></View>
        ) : (
          <FlatList
            ref={listRef}
            style={styles.flex}
            data={entries}
            keyExtractor={e => e.key}
            extraData={members}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            renderItem={({ item }) => {
              if (item.type === 'date') return (
                <View style={styles.dateSep}>
                  <View style={styles.dateLine} />
                  <Text style={styles.dateText}>{item.label}</Text>
                  <View style={styles.dateLine} />
                </View>
              )
              const isMine = item.msg.sender_id === currentUserId
              const isOpt  = item.msg.id.startsWith('optimistic-')
              return (
                <View style={isOpt ? styles.optimistic : undefined}>
                  <GroupBubble
                    msg={item.msg}
                    isMine={isMine}
                    senderName={isMine ? 'You' : memberName(item.msg.sender_id)}
                    memberName={memberName}
                    currentUserId={currentUserId}
                    seenBy={seenByFor(item.msg, isMine)}
                    onLongPress={setPickerMsgId}
                    onReact={handleReact}
                    onReply={setReplyTo}
                  />
                </View>
              )
            }}
          />
        )}

        {typingLabel && (
          <View style={styles.typingRow}>
            <TypingDots />
            <Text style={styles.typingLabel}>{typingLabel}</Text>
          </View>
        )}

        {replyTo && (
          <View style={styles.replyPreview}>
            <CornerUpLeft size={14} color={C.cyan} />
            <Text style={styles.replyPreviewText} numberOfLines={1}>{replyTo.content}</Text>
            <TouchableOpacity onPress={() => setReplyTo(null)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <X size={14} color={C.muted} />
            </TouchableOpacity>
          </View>
        )}

        {myStatus === 'accepted' && (
          <View style={styles.inputBar}>
            <TouchableOpacity
              onPress={() => { Keyboard.dismiss(); setEmojiOpen(o => !o) }}
              activeOpacity={0.7}
              style={styles.emojiToggle}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Smile size={22} color={emojiOpen ? C.cyan : C.muted} />
            </TouchableOpacity>
            <TextInput
              value={text}
              onChangeText={handleChangeText}
              onFocus={() => setEmojiOpen(false)}
              placeholder="Type a message…"
              placeholderTextColor="rgba(255,255,255,0.22)"
              style={styles.input}
              multiline
              maxLength={5000}
            />
            <TouchableOpacity
              onPress={handleSend}
              disabled={!text.trim() || sending}
              activeOpacity={0.75}
              style={[styles.sendBtn, (!text.trim() || sending) && styles.sendBtnDisabled]}
            >
              <Send size={17} color={text.trim() ? C.cyanText : C.muted} />
            </TouchableOpacity>
          </View>
        )}

        <EmojiSheet
          visible={emojiOpen}
          onClose={() => setEmojiOpen(false)}
          onSelect={(emoji) => setText(t => t + emoji)}
        />
        <Reanimated.View style={kbSpacerStyle} />

      <EmojiPicker
        visible={!!pickerMsgId}
        onClose={() => setPickerMsgId(null)}
        onPick={(emoji) => { if (pickerMsgId) handleReact(pickerMsgId, emoji) }}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  root:     { flex: 1, backgroundColor: C.bg },
  flex:     { flex: 1 },

  header:       { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 12, paddingVertical: 12, backgroundColor: C.bg, borderBottomWidth: 1, borderBottomColor: C.border },
  backBtn:      { padding: 8, borderRadius: 10 },
  headerCenter: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 },
  headerAvatar: { width: 38, height: 38, borderRadius: 19, backgroundColor: C.raised, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center' },
  headerName:   { color: C.white, fontSize: 15, fontWeight: '600' },
  headerStatus: { color: C.muted, fontSize: 11, marginTop: 1 },
  headerStatusTyping: { color: C.cyan },

  listContent: { paddingHorizontal: 12, paddingVertical: 16, gap: 4 },
  center:      { flex: 1, alignItems: 'center', justifyContent: 'center' },
  optimistic:  { opacity: 0.6 },
  declinedText: { color: C.muted, fontSize: 14 },

  dateSep: { flexDirection: 'row', alignItems: 'center', gap: 10, marginVertical: 12 },
  dateLine: { flex: 1, height: 1, backgroundColor: C.border },
  dateText:  { color: C.muted, fontSize: 11, textTransform: 'uppercase', letterSpacing: 1 },

  typingRow:   { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 6 },
  typingLabel: { color: C.muted, fontSize: 12 },

  replyPreview:     { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 10, backgroundColor: C.raised, borderTopWidth: 1, borderTopColor: C.border },
  replyPreviewText: { flex: 1, color: C.dimText, fontSize: 13 },

  inputBar:       { flexDirection: 'row', alignItems: 'flex-end', gap: 10, paddingHorizontal: 12, paddingTop: 10, paddingBottom: 10, backgroundColor: C.bg, borderTopWidth: 1, borderTopColor: C.border },
  emojiToggle:    { width: 38, height: 42, alignItems: 'center', justifyContent: 'center' },
  input:          { flex: 1, backgroundColor: C.raised, borderRadius: 20, borderWidth: 1, borderColor: C.border, paddingHorizontal: 16, paddingVertical: 10, color: C.white, fontSize: 14, maxHeight: 120 },
  sendBtn:        { width: 42, height: 42, borderRadius: 21, backgroundColor: C.cyan, alignItems: 'center', justifyContent: 'center' },
  sendBtnDisabled:{ backgroundColor: C.raised, borderWidth: 1, borderColor: C.border },
})
