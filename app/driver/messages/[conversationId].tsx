import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import {
  View, Text, FlatList, TouchableOpacity, TextInput,
  StyleSheet, ActivityIndicator,
  Modal, Keyboard,
} from 'react-native'
import { useLocalSearchParams, useRouter, useFocusEffect } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { ArrowLeft, Trash2 } from 'lucide-react-native'
import Reanimated, { useSharedValue, useAnimatedStyle, runOnJS } from 'react-native-reanimated'
import { useKeyboardHandler } from 'react-native-keyboard-controller'
import { useAuthStore } from '../../../lib/store/auth.store'
import { useMessagingStore } from '../../../lib/store/messaging.store'
import { messagingApi } from '../../../lib/api/messaging.api'
import { useMessagingRealtime } from '../../../hooks/useMessagingRealtime'
import { useStickToEnd } from '../../../hooks/useStickToEnd'
import { setActiveChat } from '../../../lib/push'
import EmojiSheet from '../../../components/messaging/EmojiSheet'
import ChatPhotoSheet from '../../../components/messaging/ChatPhotoSheet'
import { MessageItem, MessageDateDivider, TypingMessage, MessageComposer, QUICK_EMOJIS, initialsOf } from '../../../components/messaging/MessageItem'
import { useBookingMentionPicker } from '../../../components/messaging/BookingMention'
import { PHOTO_PLACEHOLDER } from '../../../lib/chatPhoto'
import { chooseMessageRemoval, type DeleteScope } from '../../../components/messaging/ReadTicks'
import type { MessageRow, ReactionTogglePayload } from '../../../types/messaging.types'
import { FONTS } from '../../../lib/config/fonts'
import { roleLabel } from '../../../lib/roles'

const C = {
  bg:       '#0a0a0a',
  raised:   '#1a1a1a',
  elevated: '#1e1e1e',
  border:   '#2a2a2a',
  cyan:     '#4df9ed',
  white:    '#ffffff',
  muted:    '#818181',
  overlay:  'rgba(0,0,0,0.6)',
}

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

interface MsgItem {
  id:              string
  conversation_id: string
  sender_id:       string
  content:         string
  sent_at:         string
  reply_to:        { message_id: string; content: string; sender_id: string } | null
  reactions:       { emoji: string; user_id: string }[]
  attachment_url?:     string | null
  attachment_stamped?: boolean
}

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
              <Trash2 size={16} color="#f62626" />
              <Text style={epS.deleteText}>Remove message</Text>
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
  label:    { color: C.muted, fontFamily: FONTS.alegreyaSans.medium, fontSize: 11, letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 14, textAlign: 'center' },
  row:      { flexDirection: 'row', justifyContent: 'space-between' },
  emojiBtn: { width: 48, height: 48, borderRadius: 24, backgroundColor: 'rgba(255,255,255,0.06)', alignItems: 'center', justifyContent: 'center' },
  emoji:    { fontSize: 24 },
  deleteRow:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 18, paddingVertical: 12, borderRadius: 12, borderWidth: 1, borderColor: 'rgba(246,38,38,0.25)', backgroundColor: 'rgba(246,38,38,0.08)' },
  deleteText: { color: '#f62626', fontFamily: FONTS.alegreyaSans.medium, fontSize: 14 },
})

export default function DmChatScreen() {
  const router        = useRouter()
  const insets        = useSafeAreaInsets()
  const { user }      = useAuthStore()
  const currentUserId = user?.user_id ?? ''

  const { conversationId, participantName, participantRole, participantId, bookingId } = useLocalSearchParams<{
    conversationId:  string
    participantName: string
    participantRole?: string
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
  // "@" opens the booking list; picking one writes its number in.
  const mention = useBookingMentionPicker(text, setText)
  const [replyTo,         setReplyTo]         = useState<MsgItem | null>(null)
  const [isTyping,        setIsTyping]        = useState(false)
  const onlineUserIds                         = useMessagingStore(s => s.onlineUserIds)
  const isOnline                              = !!participantId && onlineUserIds.includes(participantId)
  const [pickerMsgId,     setPickerMsgId]     = useState<string | null>(null)
  const [emojiOpen,       setEmojiOpen]       = useState(false)
  const [photoOpen,       setPhotoOpen]       = useState(false)
  const [otherLastReadAt, setOtherLastReadAt] = useState<string | null>(null)
  const [myLastReadAt,    setMyLastReadAt]    = useState<string | null | undefined>(undefined)

  const listRef     = useRef<FlatList>(null)
  const inputRef    = useRef<TextInput>(null)
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingIds  = useRef<Set<string>>(new Set())
  // Synchronous send lock — `sending` state lags a render, so a fast double tap got through.
  const sendingRef  = useRef(false)
  // Android keyboards (Gboard) re-commit their in-progress word after the input is cleared,
  // which put the just-sent text back in the box and invited a second send.
  const lastSent    = useRef<{ body: string; at: number } | null>(null)
  const meTypingRef    = useRef(false)
  const meTypingTimer  = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Opens on the latest message and stays there while the list fills in.
  const stick = useStickToEnd(listRef)

  // The keyboard opening keeps the newest message in view, if you were on it.
  const scrollToEnd = useCallback(() => {
    if (stick.isPinned()) listRef.current?.scrollToEnd({ animated: true })
  }, [stick])

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
    attachment_url:     raw.attachment_url ?? null,
    attachment_stamped: !!raw.attachment_stamped,
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
    if (isDraft) { setMyLastReadAt(null); return }
    messagingApi.getConversations().then(convs => {
      const conv = convs.find(c => c.conversation_id === activeConvId)
      if (conv) {
        setOtherLastReadAt(
          conv.participant_a_id === currentUserId
            ? conv.participant_b_last_read_at
            : conv.participant_a_last_read_at
        )
      }
      // Yours as the chat opened, for landing on the first unread message.
      setMyLastReadAt(prev => prev !== undefined ? prev : conv
        ? (conv.participant_a_id === currentUserId ? conv.participant_a_last_read_at : conv.participant_b_last_read_at)
        : null)
    }).catch(() => setMyLastReadAt(prev => prev ?? null))
      // Marked read only after your last read was taken.
      .finally(() => { messagingApi.markAsRead(activeConvId).catch(() => {}) })
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
    onMessageUnsent: ({ message_id }) => setMessages(prev => prev.filter(m => m.id !== message_id)),
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
      // No jump here: the list follows it only if you're at the bottom (useStickToEnd).
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


  /** Sends the typed text, or (with `photo`) an uploaded photo and its caption. */
  const handleSend = async (photo?: { url: string; caption: string }) => {
    const typed = photo ? photo.caption : text.trim()
    if ((!typed && !photo) || sendingRef.current) return
    // A captionless photo is stored with the placeholder text; using it here
    // lets the live echo match and replace the optimistic bubble.
    const body = photo && !typed ? PHOTO_PLACEHOLDER : typed
    if (!photo && lastSent.current && lastSent.current.body === body && Date.now() - lastSent.current.at < 2000) {
      clearInput()
      return
    }
    sendingRef.current = true
    if (!photo) lastSent.current = { body, at: Date.now() }

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
      attachment_url:  photo?.url ?? null,
    }
    // Sending always goes to the newest message.
    stick.jumpToEnd(false)
    setMessages(prev => [...prev, optimistic])
    if (!photo) clearInput()
    setReplyTo(null)
    if (meTypingTimer.current) clearTimeout(meTypingTimer.current)
    stopMeTyping()
    setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 80)

    try {
      setSending(true)
      const saved = isDraft
        ? await messagingApi.sendDirectMessage({
            target_user_id:      participantId,
            content:             typed,
            attachment_url:      photo?.url,
            reply_to_message_id: replyToId,
            booking_id:          bookingId || undefined,
          })
        : await messagingApi.sendMessage(activeConvId, {
            content:             typed,
            attachment_url:      photo?.url,
            reply_to_message_id: replyToId,
          })
      if (isDraft) setActiveConvId(saved.conversation_id)
      setMessages(prev => prev.map(m => m.id === oid ? toItem(saved) : m))
      pendingIds.current.delete(oid)
    } catch {
      pendingIds.current.delete(oid)
      setMessages(prev => prev.filter(m => m.id !== oid))
    } finally {
      sendingRef.current = false
      setSending(false)
    }
  }

  const clearInput = () => {
    setText('')
    inputRef.current?.clear()
    // Stay in the box, so the next message can be typed straight away.
    inputRef.current?.focus()
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

  const handleDelete = async (messageId: string, scope: DeleteScope = 'me') => {
    if (messageId.startsWith('optimistic-')) return
    setMessages(prev => prev.filter(m => m.id !== messageId))
    try { await messagingApi.deleteMessage(messageId, scope) }
    catch { fetchMessages() }
  }

  const stopMeTyping = useCallback(() => {
    if (!meTypingRef.current) return
    meTypingRef.current = false
    broadcastTyping(false)
  }, [broadcastTyping])

  const handleChangeText = (val: string) => {
    const recent = lastSent.current
    if (recent && Date.now() - recent.at < 1500 && val.trim() === recent.body) {
      // The keyboard echoing the message we just sent — drop it.
      clearInput()
      return
    }
    setText(val)
    if (val.trim() && !meTypingRef.current) { meTypingRef.current = true; broadcastTyping(true) }
    else if (!val.trim()) stopMeTyping()
    if (meTypingTimer.current) clearTimeout(meTypingTimer.current)
    meTypingTimer.current = setTimeout(stopMeTyping, 2500)
  }

  type Entry =
    | { type: 'date'; key: string; label: string }
    | { type: 'msg';  key: string; msg: MsgItem; showName: boolean }

  const entries: Entry[] = []
  let lastDay = ''
  messages.forEach((msg, i) => {
    const d = dayKey(msg.sent_at)
    if (d !== lastDay) { entries.push({ type: 'date', key: `sep-${d}`, label: formatDateSeparator(msg.sent_at) }); lastDay = d }
    // Name + avatar on the last message of a run from one sender.
    const next = messages[i + 1]
    entries.push({ type: 'msg', key: msg.id, msg, showName: !next || next.sender_id !== msg.sender_id || dayKey(next.sent_at) !== d })
  })


  // Opening the chat: your first unread message, or the newest when all is read.
  useEffect(() => {
    if (loading || myLastReadAt === undefined) return
    const readMs = myLastReadAt ? parsePHT(myLastReadAt).getTime() : null
    const first = entries.findIndex(e => e.type === 'msg' &&
      e.msg.sender_id !== currentUserId && !e.msg.id.startsWith('optimistic-') &&
      (readMs === null || parsePHT(e.msg.sent_at).getTime() > readMs))
    // One row earlier, so the date line above it shows too.
    stick.place(first >= 0 ? Math.max(0, first - 1) : null)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, myLastReadAt])

  // Every message of yours up to the other person's last read has been seen.
  const readMs = useMemo(
    () => (otherLastReadAt ? parsePHT(otherLastReadAt).getTime() : null),
    [otherLastReadAt],
  )
  const isSeen = (m: MsgItem) =>
    readMs !== null && !m.id.startsWith('optimistic-') && parsePHT(m.sent_at).getTime() <= readMs

  const name = participantName ?? 'Chat'

  const fullName = participantRole ? `${name} (${roleLabel(participantRole)})` : name

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
            <Text style={styles.headerName} numberOfLines={1}>
              {fullName}
            </Text>
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
            extraData={otherLastReadAt}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            onContentSizeChange={stick.onContentSizeChange}
            onLayout={stick.onLayout}
            onScroll={stick.onScroll}
            onScrollToIndexFailed={stick.onScrollToIndexFailed}
            scrollEventThrottle={64}
            renderItem={({ item }) => {
              if (item.type === 'date') return <MessageDateDivider label={item.label} />
              const isMine = item.msg.sender_id === currentUserId
              const reply  = item.msg.reply_to
              return (
                <MessageItem
                  msg={item.msg}
                  isMine={isMine}
                  currentUserId={currentUserId}
                  senderName={fullName}
                  showName={item.showName}
                  initials={initialsOf(name)}
                  online={isOnline}
                  time={formatMsgTime(item.msg.sent_at)}
                  seen={isMine ? isSeen(item.msg) : undefined}
                  replyName={reply ? (reply.sender_id === currentUserId ? 'You' : name) : undefined}
                  onLongPress={setPickerMsgId}
                  onReact={handleReact}
                  onReply={() => setReplyTo(item.msg)}
                />
              )
            }}
          />
        )}

        {isTyping && (
          <View style={styles.typingRow}>
            <TypingMessage name={fullName} initials={initialsOf(name)} />
          </View>
        )}

        <MessageComposer
          inputRef={inputRef}
          value={text}
          onChangeText={handleChangeText}
          onFocus={() => setEmojiOpen(false)}
          onSend={() => void handleSend()}
          sending={sending}
          emojiOpen={emojiOpen}
          onToggleEmoji={() => { Keyboard.dismiss(); setEmojiOpen(o => !o) }}
          onPhoto={() => { Keyboard.dismiss(); setEmojiOpen(false); setPhotoOpen(true) }}
          replyTo={replyTo ? { name: replyTo.sender_id === currentUserId ? 'yourself' : name, content: replyTo.content } : null}
          onCancelReply={() => setReplyTo(null)}
          mention={mention}
          showJumpToLatest={!stick.atEnd}
          onJumpToLatest={() => stick.jumpToEnd()}
        />

        <ChatPhotoSheet
          visible={photoOpen}
          onClose={() => setPhotoOpen(false)}
          onSend={(url, caption) => { setPhotoOpen(false); void handleSend({ url, caption }) }}
        />

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
        onDelete={() => {
          const id = pickerMsgId
          if (!id) return
          const mine = messages.some(m => m.id === id && m.sender_id === currentUserId)
          // Let the long-press sheet finish closing first; iOS drops an alert opened mid-dismiss.
          setTimeout(() => chooseMessageRemoval(mine, (scope) => { void handleDelete(id, scope) }), 300)
        }}
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
  headerAvatarText: { color: C.white, fontFamily: FONTS.alegreyaSans.bold, fontSize: 14 },
  onlineDot: { position: 'absolute', bottom: 0, right: 0, width: 11, height: 11, borderRadius: 6, backgroundColor: '#3af626', borderWidth: 2, borderColor: C.bg },
  headerName: { color: C.white, fontFamily: FONTS.alegreyaSans.medium, fontSize: 15 },
  headerStatus: { color: C.muted, fontFamily: FONTS.alegreyaSans.regular, fontSize: 11, marginTop: 1 },
  headerStatusOnline: { color: '#3af626' },

  listContent: { paddingHorizontal: 12, paddingVertical: 16, gap: 10 },
  center:      { flex: 1, alignItems: 'center', justifyContent: 'center' },

  typingRow: { paddingHorizontal: 12, paddingVertical: 6 },

})
