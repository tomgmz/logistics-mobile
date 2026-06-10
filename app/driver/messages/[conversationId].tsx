import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import {
  View, Text, FlatList, TouchableOpacity, TextInput,
  StyleSheet, ActivityIndicator,
  Animated, Modal, Keyboard,
} from 'react-native'
import { useLocalSearchParams, useRouter, useFocusEffect } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { ArrowLeft, Send, CornerUpLeft, X, Smile, Trash2 } from 'lucide-react-native'
import Reanimated, { useSharedValue, useAnimatedStyle, withSpring, runOnJS } from 'react-native-reanimated'
import { useKeyboardHandler } from 'react-native-keyboard-controller'
import { GestureDetector, Gesture } from 'react-native-gesture-handler'
import { useAuthStore } from '../../../lib/store/auth.store'
import { useMessagingStore } from '../../../lib/store/messaging.store'
import { messagingApi } from '../../../lib/api/messaging.api'
import { useMessagingRealtime } from '../../../hooks/useMessagingRealtime'
import { setActiveChat } from '../../../lib/push'
import EmojiSheet from '../../../components/messaging/EmojiSheet'
import type { MessageRow, ReactionTogglePayload } from '../../../types/messaging.types'

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
  const d   = parsePHT(iso)
  const now = new Date()
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

interface ReactionGroup { emoji: string; count: number; reacted: boolean }

function groupReactions(reactions: { emoji: string; user_id: string }[], userId: string): ReactionGroup[] {
  const map = new Map<string, { count: number; reacted: boolean }>()
  for (const r of reactions) {
    const cur = map.get(r.emoji) ?? { count: 0, reacted: false }
    map.set(r.emoji, { count: cur.count + 1, reacted: cur.reacted || r.user_id === userId })
  }
  return [...map.entries()].map(([emoji, v]) => ({ emoji, ...v }))
}

interface MsgItem {
  id:              string
  conversation_id: string
  sender_id:       string
  content:         string
  sent_at:         string
  reply_to:        { message_id: string; content: string; sender_id: string } | null
  reactions:       { emoji: string; user_id: string }[]
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
  reactions: { emoji: string; user_id: string }[]
  currentUserId: string
  isMine: boolean
  onToggle: (emoji: string) => void
}) {
  const grouped = groupReactions(reactions, currentUserId)
  if (!grouped.length) return null
  return (
    <View style={[rS.wrap, isMine ? rS.wrapMine : rS.wrapTheirs]}>
      {grouped.map(r => (
        <TouchableOpacity
          key={r.emoji}
          onPress={() => onToggle(r.emoji)}
          activeOpacity={0.75}
          style={[rS.badge, r.reacted && rS.badgeActive]}
        >
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

function EmojiPicker({ visible, onClose, onPick, onDelete }: {
  visible:   boolean
  onClose:   () => void
  onPick:    (emoji: string) => void
  onDelete?: () => void
}) {
  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={onClose}>
      <TouchableOpacity style={epS.backdrop} activeOpacity={1} onPress={onClose}>
        <View style={epS.sheet}>
          <Text style={epS.label}>React</Text>
          <View style={epS.row}>
            {QUICK_EMOJIS.map(e => (
              <TouchableOpacity
                key={e}
                onPress={() => { onPick(e); onClose() }}
                activeOpacity={0.7}
                style={epS.emojiBtn}
              >
                <Text style={epS.emoji}>{e}</Text>
              </TouchableOpacity>
            ))}
          </View>
          {onDelete && (
            <TouchableOpacity
              style={epS.deleteRow}
              onPress={() => { onDelete(); onClose() }}
              activeOpacity={0.7}
            >
              <Trash2 size={16} color="#f87171" />
              <Text style={epS.deleteText}>Delete for me</Text>
            </TouchableOpacity>
          )}
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
  deleteRow:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 18, paddingVertical: 12, borderRadius: 12, borderWidth: 1, borderColor: 'rgba(248,113,113,0.25)', backgroundColor: 'rgba(248,113,113,0.08)' },
  deleteText: { color: '#f87171', fontSize: 14, fontWeight: '600' },
})

function Bubble({ msg, isMine, showSeen, participantName, currentUserId, onLongPress, onReact, onReply }: {
  msg:             MsgItem
  isMine:          boolean
  showSeen:        boolean
  participantName: string
  currentUserId:   string
  onLongPress:     (id: string) => void
  onReact:         (id: string, emoji: string) => void
  onReply:         (m: MsgItem) => void
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
        {isMine && (
          <Reanimated.View style={[bS.swipeIcon, iconAnim]}>
            <CornerUpLeft size={16} color="rgba(255,255,255,0.5)" />
          </Reanimated.View>
        )}

        <Reanimated.View style={[bS.wrap, isMine ? bS.wrapMine : bS.wrapTheirs, bubbleAnim]}>

          {hasReply && (
            <>
              <View style={[bS.attribution, isMine ? bS.attributionMine : bS.attributionTheirs]}>
                <CornerUpLeft size={11} color="rgba(255,255,255,0.35)" />
                <Text style={bS.attributionText}>
                  {isMine
                    ? `You replied to ${msg.reply_to!.sender_id === currentUserId ? 'yourself' : participantName}`
                    : `${participantName} replied to ${msg.reply_to!.sender_id === currentUserId ? 'you' : 'themselves'}`}
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

          <View style={[bS.meta, isMine && { alignSelf: 'flex-end' }]}>
            <Text style={bS.time}>{formatMsgTime(msg.sent_at)}</Text>
            {isMine && showSeen && <Text style={bS.seen}> · Seen</Text>}
          </View>
        </Reanimated.View>

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

  meta:         { flexDirection: 'row', alignItems: 'center', marginTop: 3, marginHorizontal: 2 },
  time:         { color: C.muted, fontSize: 10 },
  seen:         { color: C.cyan, fontSize: 10 },
})

export default function DmChatScreen() {
  const router        = useRouter()
  const insets        = useSafeAreaInsets()
  const { user }      = useAuthStore()
  const currentUserId = user?.user_id ?? ''

  const { conversationId, participantName, participantId, bookingId } = useLocalSearchParams<{
    conversationId:  string
    participantName: string
    participantId:   string
    bookingId?:      string
  }>()

  const [activeConvId, setActiveConvId] = useState(conversationId)
  const isDraft = !activeConvId || activeConvId === 'new'

  // Suppress push notifications for this conversation while it is on screen.
  useFocusEffect(
    useCallback(() => {
      setActiveChat(activeConvId ?? null)
      return () => setActiveChat(null)
    }, [activeConvId])
  )

  const [messages,        setMessages]        = useState<MsgItem[]>([])
  const [loading,         setLoading]         = useState(true)
  const [sending,         setSending]         = useState(false)
  const [text,            setText]            = useState('')
  const [replyTo,         setReplyTo]         = useState<MsgItem | null>(null)
  const [isTyping,        setIsTyping]        = useState(false)
  const onlineUserIds                         = useMessagingStore(s => s.onlineUserIds)
  const isOnline                              = !!participantId && onlineUserIds.includes(participantId)
  const [pickerMsgId,     setPickerMsgId]     = useState<string | null>(null)
  const [emojiOpen,       setEmojiOpen]       = useState(false)
  const [otherLastReadAt, setOtherLastReadAt] = useState<string | null>(null)

  const listRef     = useRef<FlatList>(null)
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingIds  = useRef<Set<string>>(new Set())
  const meTypingRef    = useRef(false)
  const meTypingTimer  = useRef<ReturnType<typeof setTimeout> | null>(null)

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

  const toItem = useCallback((raw: MessageRow): MsgItem => ({
    id:              raw.message_id,
    conversation_id: raw.conversation_id,
    sender_id:       raw.sender_id,
    content:         raw.content,
    sent_at:         raw.sent_at,
    reply_to:        raw.reply_to,
    reactions:       raw.reactions ?? [],
  }), [])

  const fetchMessages = useCallback(async () => {
    if (isDraft) { setLoading(false); return }
    try {
      const raw = await messagingApi.getMessages(activeConvId, { limit: 60 })
      setMessages(raw.map(toItem))
    } catch { /* silent */ }
    finally { setLoading(false) }
  }, [activeConvId, isDraft, toItem])

  useEffect(() => { fetchMessages() }, [fetchMessages])

  useEffect(() => {
    if (isDraft) return
    messagingApi.markAsRead(activeConvId).catch(() => {})
    messagingApi.getConversations().then(convs => {
      const conv = convs.find(c => c.conversation_id === activeConvId)
      if (conv) {
        setOtherLastReadAt(
          conv.participant_a_id === currentUserId
            ? conv.participant_b_last_read_at
            : conv.participant_a_last_read_at
        )
      }
    }).catch(() => {})
  }, [activeConvId, isDraft, currentUserId])

  const applyReaction = useCallback((payload: ReactionTogglePayload) => {
    setMessages(prev => prev.map(m => {
      if (m.id !== payload.message_id) return m
      const base = m.reactions.filter(r => r.user_id !== payload.user_id)
      return {
        ...m,
        reactions: payload.action === 'added'
          ? [...base, { emoji: payload.emoji, user_id: payload.user_id }]
          : base,
      }
    }))
  }, [])

  const { broadcastTyping } = useMessagingRealtime({
    currentUserId,
    conversationId: isDraft ? `draft:${participantId}` : activeConvId,
    onNewMessage: (raw) => {
      const inc = toItem(raw)
      setMessages(prev => {
        const match = [...pendingIds.current].find(id => prev.some(m => m.id === id && m.content === inc.content))
        if (match) { pendingIds.current.delete(match); return prev.map(m => m.id === match ? inc : m) }
        if (prev.some(m => m.id === inc.id)) return prev
        return [...prev, inc]
      })
      if (raw.sender_id !== currentUserId && !isDraft) messagingApi.markAsRead(activeConvId).catch(() => {})
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 80)
    },
    onReadReceipt: ({ conversation_id, reader_id, last_read_at }) => {
      if (conversation_id !== activeConvId) return
      if (reader_id !== currentUserId) setOtherLastReadAt(last_read_at)
    },
    onReactionToggle: applyReaction,
    onTyping: (uid, isTypingNow) => {
      if (uid !== participantId) return
      setIsTyping(isTypingNow)
      if (typingTimer.current) clearTimeout(typingTimer.current)
      if (isTypingNow) typingTimer.current = setTimeout(() => setIsTyping(false), 3000)
    },
  })

  useEffect(() => {
    if (!loading && messages.length > 0) {
      setTimeout(() => listRef.current?.scrollToEnd({ animated: false }), 100)
    }
  }, [loading])

  const handleSend = async () => {
    const body = text.trim()
    if (!body) return

    const oid = `optimistic-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const replyToId = replyTo?.id
    pendingIds.current.add(oid)
    const optimistic: MsgItem = {
      id:              oid,
      conversation_id: isDraft ? '' : activeConvId,
      sender_id:       currentUserId,
      content:         body,
      sent_at:         new Date().toISOString(),
      reply_to:        replyTo ? { message_id: replyTo.id, content: replyTo.content, sender_id: replyTo.sender_id } : null,
      reactions:       [],
    }
    setMessages(prev => [...prev, optimistic])
    setText('')
    setReplyTo(null)
    if (meTypingTimer.current) clearTimeout(meTypingTimer.current)
    stopMeTyping()
    setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 80)

    try {
      setSending(true)
      const saved = isDraft
        ? await messagingApi.sendDirectMessage({
            target_user_id:      participantId,
            content:             body,
            reply_to_message_id: replyToId,
            booking_id:          bookingId || undefined,
          })
        : await messagingApi.sendMessage(activeConvId, {
            content:             body,
            reply_to_message_id: replyToId,
          })
      if (isDraft) setActiveConvId(saved.conversation_id)
      setMessages(prev => prev.map(m => m.id === oid ? toItem(saved) : m))
      pendingIds.current.delete(oid)
    } catch {
      pendingIds.current.delete(oid)
      setMessages(prev => prev.filter(m => m.id !== oid))
    } finally { setSending(false) }
  }

  const handleReact = async (messageId: string, emoji: string) => {
    // Optimistic update
    setMessages(prev => prev.map(m => {
      if (m.id !== messageId) return m
      const base    = m.reactions.filter(r => r.user_id !== currentUserId)
      const already = m.reactions.find(r => r.user_id === currentUserId)
      return {
        ...m,
        reactions: already?.emoji === emoji
          ? base
          : [...base, { emoji, user_id: currentUserId }],
      }
    }))
    try {
      await messagingApi.reactToMessage(activeConvId, messageId, emoji)
    } catch {
      fetchMessages()
    }
  }

  const handleDelete = async (messageId: string) => {
    if (messageId.startsWith('optimistic-')) return
    setMessages(prev => prev.filter(m => m.id !== messageId))
    try { await messagingApi.deleteMessage(messageId) }
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
    | { type: 'msg';  key: string; msg: MsgItem }

  const entries: Entry[] = []
  let lastDay = ''
  for (const msg of messages) {
    const d = dayKey(msg.sent_at)
    if (d !== lastDay) { entries.push({ type: 'date', key: `sep-${d}`, label: formatDateSeparator(msg.sent_at) }); lastDay = d }
    entries.push({ type: 'msg', key: msg.id, msg })
  }

  const lastSeenId = useMemo(() => {
    if (!otherLastReadAt) return null
    const readMs = parsePHT(otherLastReadAt).getTime()
    return messages
      .filter(m => m.sender_id === currentUserId && !m.id.startsWith('optimistic-') && parsePHT(m.sent_at).getTime() <= readMs)
      .at(-1)?.id ?? null
  }, [messages, otherLastReadAt, currentUserId])

  const name = participantName ?? 'Chat'

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} activeOpacity={0.7} style={styles.backBtn}>
          <ArrowLeft size={20} color={C.white} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <View style={styles.headerAvatar}>
            <Text style={styles.headerAvatarText}>{name.charAt(0).toUpperCase()}</Text>
            {isOnline && <View style={styles.onlineDot} />}
          </View>
          <View>
            <Text style={styles.headerName} numberOfLines={1}>{name}</Text>
            <Text style={[styles.headerStatus, isOnline && styles.headerStatusOnline]}>
              {isTyping ? 'typing…' : isOnline ? 'Active now' : 'Offline'}
            </Text>
          </View>
        </View>
      </View>

        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator size="small" color={C.cyan} />
          </View>
        ) : (
          <FlatList
            ref={listRef}
            style={styles.flex}
            data={entries}
            keyExtractor={e => e.key}
            extraData={lastSeenId}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            renderItem={({ item }) => {
              if (item.type === 'date') {
                return (
                  <View style={styles.dateSep}>
                    <View style={styles.dateLine} />
                    <Text style={styles.dateText}>{item.label}</Text>
                    <View style={styles.dateLine} />
                  </View>
                )
              }
              if (item.msg.id === 'typing') {
                return (
                  <View style={styles.typingWrap}>
                    <View style={styles.typingAvatar}>
                      <Text style={styles.typingAvatarText}>{name.charAt(0).toUpperCase()}</Text>
                    </View>
                    <View style={styles.typingBubble}><TypingDots /></View>
                  </View>
                )
              }
              const isMine       = item.msg.sender_id === currentUserId
              const isOptimistic = item.msg.id.startsWith('optimistic-')
              return (
                <View style={isOptimistic ? styles.optimistic : undefined}>
                  <Bubble
                    msg={item.msg}
                    isMine={isMine}
                    showSeen={item.msg.id === lastSeenId}
                    participantName={name}
                    currentUserId={currentUserId}
                    onLongPress={setPickerMsgId}
                    onReact={handleReact}
                    onReply={setReplyTo}
                  />
                </View>
              )
            }}
          />
        )}

        {isTyping && (
          <View style={styles.typingRow}>
            <TypingDots />
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
        onDelete={() => { if (pickerMsgId) handleDelete(pickerMsgId) }}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  root:      { flex: 1, backgroundColor: C.bg },
  flex:      { flex: 1 },

  header:    { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 12, paddingVertical: 12, backgroundColor: C.bg, borderBottomWidth: 1, borderBottomColor: C.border },
  backBtn:   { padding: 8, borderRadius: 10 },
  headerCenter: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 },
  headerAvatar: { width: 38, height: 38, borderRadius: 19, backgroundColor: C.raised, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center', position: 'relative' },
  headerAvatarText: { color: C.white, fontSize: 14, fontWeight: '700' },
  onlineDot: { position: 'absolute', bottom: 0, right: 0, width: 11, height: 11, borderRadius: 6, backgroundColor: '#4ade80', borderWidth: 2, borderColor: C.bg },
  headerName: { color: C.white, fontSize: 15, fontWeight: '600' },
  headerStatus: { color: C.muted, fontSize: 11, marginTop: 1 },
  headerStatusOnline: { color: '#4ade80' },

  listContent: { paddingHorizontal: 12, paddingVertical: 16, gap: 4 },
  center:      { flex: 1, alignItems: 'center', justifyContent: 'center' },
  optimistic:  { opacity: 0.6 },

  dateSep: { flexDirection: 'row', alignItems: 'center', gap: 10, marginVertical: 12 },
  dateLine: { flex: 1, height: 1, backgroundColor: C.border },
  dateText:  { color: C.muted, fontSize: 11, textTransform: 'uppercase', letterSpacing: 1 },

  typingRow: { paddingHorizontal: 16, paddingVertical: 6 },
  typingWrap: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, marginBottom: 4, alignSelf: 'flex-start' },
  typingAvatar: { width: 28, height: 28, borderRadius: 14, backgroundColor: C.raised, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center' },
  typingAvatarText: { color: C.white, fontSize: 10, fontWeight: '700' },
  typingBubble: { backgroundColor: C.raised, borderWidth: 1, borderColor: C.border, borderRadius: 18, borderBottomLeftRadius: 4, paddingHorizontal: 14, paddingVertical: 8 },

  replyPreview: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 10, backgroundColor: C.raised, borderTopWidth: 1, borderTopColor: C.border },
  replyPreviewText: { flex: 1, color: C.dimText, fontSize: 13 },

  inputBar: { flexDirection: 'row', alignItems: 'flex-end', gap: 10, paddingHorizontal: 12, paddingTop: 10, paddingBottom: 10, backgroundColor: C.bg, borderTopWidth: 1, borderTopColor: C.border },
  emojiToggle: { width: 38, height: 42, alignItems: 'center', justifyContent: 'center' },
  input:    { flex: 1, backgroundColor: C.raised, borderRadius: 20, borderWidth: 1, borderColor: C.border, paddingHorizontal: 16, paddingVertical: 10, color: C.white, fontSize: 14, maxHeight: 120 },
  sendBtn:  { width: 42, height: 42, borderRadius: 21, backgroundColor: C.cyan, alignItems: 'center', justifyContent: 'center' },
  sendBtnDisabled: { backgroundColor: C.raised, borderWidth: 1, borderColor: C.border },
})
