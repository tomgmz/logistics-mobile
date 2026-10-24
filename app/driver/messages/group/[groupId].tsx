import React, { useState, useEffect, useCallback, useRef } from 'react'
import {
  View, Text, FlatList, TouchableOpacity, TextInput,
  StyleSheet, ActivityIndicator,
  Modal, Keyboard, Alert,
} from 'react-native'
import { useLocalSearchParams, useRouter, useFocusEffect } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { ArrowLeft, Users, Check, X as XIcon, MoreVertical, UserPlus, Pencil, Inbox, Trash2 } from 'lucide-react-native'
import Reanimated, { useSharedValue, useAnimatedStyle, runOnJS } from 'react-native-reanimated'
import { useKeyboardHandler } from 'react-native-keyboard-controller'
import { useAuthStore } from '../../../../lib/store/auth.store'
import { messagingApi } from '../../../../lib/api/messaging.api'
import { useMessagingRealtime } from '../../../../hooks/useMessagingRealtime'
import { setActiveChat } from '../../../../lib/push'
import EmojiSheet from '../../../../components/messaging/EmojiSheet'
import { useStickToEnd } from '../../../../hooks/useStickToEnd'
import ChatPhotoSheet from '../../../../components/messaging/ChatPhotoSheet'
import { MessageItem, MessageDateDivider, TypingMessage, MessageComposer, QUICK_EMOJIS, initialsOf } from '../../../../components/messaging/MessageItem'
import { useBookingMentionPicker } from '../../../../components/messaging/BookingMention'
import { PHOTO_PLACEHOLDER } from '../../../../lib/chatPhoto'
import GroupSheets, { type GroupSheetView, type SheetMember } from '../../../../components/messaging/GroupSheets'
import { chooseMessageRemoval, type DeleteScope } from '../../../../components/messaging/ReadTicks'
import type { GroupMessageRaw, ReactionTogglePayload, GroupReadReceiptPayload, GroupSystemEvent, GroupMemberRequest } from '../../../../types/messaging.types'
import { FONTS } from '../../../../lib/config/fonts'
import { nameWithRole } from '../../../../lib/roles'

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
  amber:    '#ff7a30',
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
  kind:     'text' | 'system'
  meta:     GroupSystemEvent | null
  attachment_url?:     string | null
  attachment_stamped?: boolean
}

/** "A and B", "A, B and C". */
function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? ''
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

/**
 * The sentence for a group event line, from the reader's side: "You named the
 * group Dispatch." / "Ana Cruz added you to the group." Falls back to the
 * stored sentence when the event cannot be read.
 */
function groupEventText(msg: GMsg, currentUserId: string, nameOf: (uid: string) => string): string {
  const meta = msg.meta
  if (!meta) return msg.content
  const actor = msg.sender_id === currentUserId ? 'You' : nameOf(msg.sender_id)
  if (meta.event === 'renamed') return `${actor} named the group ${meta.name}.`
  if (meta.event === 'added') {
    const names = meta.user_ids.map((id, i) => (id === currentUserId ? 'you' : meta.names[i] ?? nameOf(id)))
    return `${actor} added ${joinNames(names)} to the group.`
  }
  if (meta.event === 'removed') {
    return `${actor} removed ${meta.user_id === currentUserId ? 'you' : meta.name} from the group.`
  }
  return msg.content
}

function EmojiPicker({ visible, onClose, onPick, onDelete }: {
  visible: boolean; onClose: () => void; onPick: (e: string) => void; onDelete?: () => void
}) {
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
          {onDelete && (
            <TouchableOpacity style={epS.deleteRow} onPress={() => { onDelete(); onClose() }} activeOpacity={0.7}>
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

const bS = StyleSheet.create({
  // Seen avatars sit at the right edge under the newest message each member read.
  seenRow:        { flexDirection: 'row', alignItems: 'center', gap: 2 },
  seenAvatar:     { width: 14, height: 14, borderRadius: 7, backgroundColor: C.raised, borderWidth: 1, borderColor: 'rgba(255,255,255,0.25)', alignItems: 'center', justifyContent: 'center' },
  seenAvatarText: { color: 'rgba(255,255,255,0.7)', fontFamily: FONTS.alegreyaSans.bold, fontSize: 7 },
  seenOverflow:   { color: 'rgba(255,255,255,0.4)', fontFamily: FONTS.alegreyaSans.regular, fontSize: 9, marginLeft: 1 },
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
          <XIcon size={14} color="#f62626" />
        </TouchableOpacity>
        <TouchableOpacity onPress={() => respond(true)} disabled={loading} style={[invS.btn, invS.accept]}>
          {loading ? <ActivityIndicator size="small" color={C.cyanText} /> : <Check size={14} color={C.cyanText} />}
        </TouchableOpacity>
      </View>
    </View>
  )
}
const invS = StyleSheet.create({
  banner:  { flexDirection: 'row', alignItems: 'center', gap: 10, marginHorizontal: 12, marginBottom: 10, padding: 12, borderRadius: 14, backgroundColor: 'rgba(255,122,48,0.08)', borderWidth: 1, borderColor: 'rgba(255,122,48,0.25)' },
  title:   { color: C.amber, fontFamily: FONTS.alegreyaSans.bold, fontSize: 12 },
  sub:     { color: C.muted, fontFamily: FONTS.alegreyaSans.regular, fontSize: 11, marginTop: 1 },
  btns:    { flexDirection: 'row', gap: 6 },
  btn:     { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  decline: { backgroundColor: 'rgba(246,38,38,0.12)', borderWidth: 1, borderColor: 'rgba(246,38,38,0.25)' },
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
  // "@" opens the booking list; picking one writes its number in.
  const mention = useBookingMentionPicker(text, setText)
  const [replyTo,     setReplyTo]     = useState<GMsg | null>(null)
  const [myStatus,    setMyStatus]    = useState(initialStatus ?? 'accepted')
  const [typingUsers, setTyping]      = useState<string[]>([])
  const [pickerMsgId, setPickerMsgId] = useState<string | null>(null)
  const [emojiOpen,   setEmojiOpen]   = useState(false)
  const [photoOpen,   setPhotoOpen]   = useState(false)
  const [membersMap,  setMembersMap]  = useState<Record<string, string>>({})
  const [members,     setMembers]     = useState<(SheetMember & { last_read_at: string | null })[]>([])
  const [myLastReadAt, setMyLastReadAt] = useState<string | null | undefined>(undefined)
  const [title,       setTitle]       = useState<string | null>(null)
  const [createdBy,   setCreatedBy]   = useState('')
  const [requests,    setRequests]    = useState<GroupMemberRequest[]>([])
  const [sheet,       setSheet]       = useState<GroupSheetView | null>(null)
  const inputRef = useRef<TextInput>(null)

  // Only the creator renames the group and changes who is in it; everyone else asks.
  const isCreator = !!createdBy && createdBy === currentUserId

  const listRef      = useRef<FlatList>(null)
  const pendingIds   = useRef<Set<string>>(new Set())
  const typingTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({})
  const meTypingRef   = useRef(false)
  const meTypingTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

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

  // Shown above someone's messages: "Tom Ervin Gomez (Company Administrator)".
  const senderLabel = (uid: string): string => {
    const m = members.find(x => x.user_id === uid)
    return m ? nameWithRole(m.first_name, m.last_name, m.role) : memberName(uid)
  }

  const memberName = useCallback((uid: string): string => {
    if (uid === currentUserId) return 'You'
    return membersMap[uid] ?? 'Member'
  }, [membersMap, currentUserId])

  const others = members.filter(m => m.status === 'accepted' && m.user_id !== currentUserId)

  // Your message gets the double check once every other member has read it.
  const seenByAll = useCallback((msg: GMsg): boolean => {
    if (!others.length) return false
    const sentMs = parsePHT(msg.sent_at).getTime()
    return others.every(m => m.last_read_at !== null && parsePHT(m.last_read_at).getTime() >= sentMs)
  }, [others])

  // Each member's avatar appears once, under the newest message they have read.
  const seenAt: Record<string, typeof members> = {}
  for (const m of others) {
    if (!m.last_read_at) continue
    const readMs = parsePHT(m.last_read_at).getTime()
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i]
      if (msg.kind === 'system' || msg.id.startsWith('optimistic-') || msg.sender_id === m.user_id) continue
      if (parsePHT(msg.sent_at).getTime() <= readMs) { (seenAt[msg.id] ??= []).push(m); break }
    }
  }

  const toItem = useCallback((raw: GroupMessageRaw): GMsg => ({
    id:       raw.message_id,
    group_id: raw.group_id,
    sender_id:raw.sender_id,
    content:  raw.content,
    sent_at:  raw.sent_at,
    reply_to: raw.reply_to,
    reactions:raw.reactions ?? [],
    kind:     raw.message_type === 'system' ? 'system' : 'text',
    meta:     raw.meta ?? null,
    attachment_url:     raw.attachment_url ?? null,
    attachment_stamped: !!raw.attachment_stamped,
  }), [])

  // The group itself: name, creator, members, and the creator's requests.
  const loadGroup = useCallback(async () => {
    if (!groupId) return
    try {
      const rawGroups = await messagingApi.getGroups()
      const found = rawGroups.find(g => g.group_id === groupId)
      if (!found) {
        // Taken out of the group (or it is gone): nothing left to show here.
        if (myStatus === 'accepted') {
          Alert.alert('Removed from group', 'You are no longer a member of this group.')
          router.back()
        }
        return
      }
      const map: Record<string, string> = {}
      for (const m of found.members) {
        map[m.user.user_id] = `${m.user.first_name ?? ''} ${m.user.last_name ?? ''}`.trim()
      }
      setMembersMap(map)
      // Yours as the chat opened (first load only), for landing on the first unread message.
      const mine = found.members.find(m => m.user.user_id === currentUserId)
      setMyLastReadAt(prev => prev !== undefined ? prev : mine?.last_read_at ?? null)
      setMembers(found.members.map(m => ({
        user_id:      m.user.user_id,
        first_name:   m.user.first_name ?? '',
        last_name:    m.user.last_name ?? '',
        role:         m.user.role,
        status:       m.status,
        last_read_at: m.last_read_at ?? null,
      })))
      setTitle(found.name)
      setCreatedBy(found.created_by)
      if (found.created_by === currentUserId) {
        messagingApi.getGroupMemberRequests(groupId).then(rs => setRequests(rs ?? [])).catch(() => {})
      } else {
        setRequests([])
      }
    } catch { /* silent */ }
  }, [groupId, myStatus, currentUserId, router])

  useEffect(() => { loadGroup() }, [loadGroup])

  const fetchMessages = useCallback(async () => {
    if (!groupId || myStatus !== 'accepted') return
    try {
      const rawMsgs = await messagingApi.getGroupMessages(groupId, { limit: 60 })
      setMessages(rawMsgs.map(toItem))
    } catch { /* silent */ }
    finally { setLoading(false) }
  }, [groupId, myStatus, toItem])

  useEffect(() => { fetchMessages() }, [fetchMessages])

  // Marked read only after your last read was taken.
  useEffect(() => {
    if (myStatus !== 'accepted' || !groupId || myLastReadAt === undefined) return
    messagingApi.markGroupRead(groupId).catch(() => {})
  }, [groupId, myStatus, myLastReadAt])

  const applyReaction = useCallback((payload: ReactionTogglePayload) => {
    setMessages(prev => prev.map(m => {
      if (m.id !== payload.message_id) return m
      const base = m.reactions.filter(r => r.user_id !== payload.user_id)
      return { ...m, reactions: payload.action === 'added' ? [...base, { emoji: payload.emoji, user_id: payload.user_id }] : base }
    }))
  }, [])

  const { broadcastTyping } = useMessagingRealtime({
    currentUserId,
    onMessageUnsent: ({ message_id }) => setMessages(prev => prev.filter(m => m.id !== message_id)),
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
      // No jump here: the list follows it only if you're at the bottom (useStickToEnd).
    },
    onReactionToggle: applyReaction,
    onGroupUpdated: (p) => { if (p.group_id === groupId) loadGroup() },
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


  /** Sends the typed text, or (with `photo`) an uploaded photo and its caption. */
  const handleSend = async (photo?: { url: string; caption: string }) => {
    const typed = photo ? photo.caption : text.trim()
    if ((!typed && !photo) || !groupId || myStatus !== 'accepted') return
    // Matches what the server stores, so the live echo replaces the optimistic bubble.
    const body = photo && !typed ? PHOTO_PLACEHOLDER : typed

    const oid = `optimistic-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    pendingIds.current.add(oid)
    // Sending always goes to the newest message.
    stick.jumpToEnd(false)
    setMessages(prev => [...prev, {
      id: oid, group_id: groupId, sender_id: currentUserId, content: body,
      sent_at: new Date().toISOString(),
      reply_to: replyTo ? { message_id: replyTo.id, content: replyTo.content, sender_id: replyTo.sender_id } : null,
      kind:     'text' as const,
      meta:     null,
      reactions: [],
      attachment_url: photo?.url ?? null,
    }])
    if (!photo) {
      setText('')
      // Stay in the box, so the next message can be typed straight away.
      inputRef.current?.focus()
    }
    setReplyTo(null)
    if (meTypingTimer.current) clearTimeout(meTypingTimer.current)
    stopMeTyping()
    setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 80)

    try {
      setSending(true)
      const saved = await messagingApi.sendGroupMessage(groupId, { content: typed, attachment_url: photo?.url, reply_to_message_id: replyTo?.id })
      setMessages(prev => prev.map(m => m.id === oid ? toItem(saved) : m))
      pendingIds.current.delete(oid)
    } catch {
      pendingIds.current.delete(oid)
      setMessages(prev => prev.filter(m => m.id !== oid))
    } finally { setSending(false) }
  }

  // Delete for me: everyone else in the group keeps the message.
  const handleDelete = async (messageId: string, scope: DeleteScope = 'me') => {
    if (messageId.startsWith('optimistic-')) return
    setMessages(prev => prev.filter(m => m.id !== messageId))
    try { await messagingApi.hideGroupMessage(groupId, messageId, scope) }
    catch { fetchMessages() }
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
    | { type: 'msg';  key: string; msg: GMsg; showName: boolean }

  const entries: Entry[] = []
  let lastDay = ''
  messages.forEach((m, i) => {
    const d = dayKey(m.sent_at)
    if (d !== lastDay) { entries.push({ type: 'date', key: `sep-${d}`, label: formatDateSeparator(m.sent_at) }); lastDay = d }
    // Name + avatar on the last message of a run; an event line breaks a run.
    const next = messages[i + 1]
    const runEnds = !next || next.kind === 'system' || next.sender_id !== m.sender_id || dayKey(next.sent_at) !== d
    entries.push({ type: 'msg', key: m.id, msg: m, showName: m.kind !== 'system' && runEnds })
  })


  // Opening the chat: your first unread message, or the newest when all is read.
  useEffect(() => {
    if (loading || myLastReadAt === undefined) return
    const readMs = myLastReadAt ? parsePHT(myLastReadAt).getTime() : null
    const first = entries.findIndex(e => e.type === 'msg' && e.msg.kind !== 'system' &&
      e.msg.sender_id !== currentUserId && !e.msg.id.startsWith('optimistic-') &&
      (readMs === null || parsePHT(e.msg.sent_at).getTime() > readMs))
    // One row earlier, so the date line above it shows too.
    stick.place(first >= 0 ? Math.max(0, first - 1) : null)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, myLastReadAt])

  const name = title ?? groupName ?? 'Group'
  const creatorLine = createdBy === currentUserId
    ? 'You created this group'
    : createdBy ? `${memberName(createdBy)} created this group` : ''
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
        <TouchableOpacity onPress={() => setSheet('menu')} activeOpacity={0.7} style={styles.backBtn}
          accessibilityLabel="Group options" hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
          <MoreVertical size={20} color={C.muted} />
        </TouchableOpacity>
      </View>

      {/* The creator's requests waiting for a decision. */}
      {isCreator && myStatus === 'accepted' && requests.length > 0 && (
        <TouchableOpacity style={styles.requestBar} activeOpacity={0.8} onPress={() => setSheet('requests')}>
          <Inbox size={15} color={C.cyan} />
          <Text style={styles.requestBarText}>
            {requests.length} member request{requests.length !== 1 ? 's' : ''} waiting for your approval
          </Text>
          <Text style={styles.requestBarLink}>Review</Text>
        </TouchableOpacity>
      )}

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
            onContentSizeChange={stick.onContentSizeChange}
            onLayout={stick.onLayout}
            onScroll={stick.onScroll}
            onScrollToIndexFailed={stick.onScrollToIndexFailed}
            scrollEventThrottle={64}
            ListHeaderComponent={myStatus === 'accepted' ? (
              <View style={styles.intro}>
                <View style={styles.introAvatar}><Users size={26} color="rgba(255,255,255,0.6)" /></View>
                <Text style={styles.introName}>{name}</Text>
                {!!creatorLine && <Text style={styles.introSub}>{creatorLine}</Text>}
                <View style={styles.introBtns}>
                  <TouchableOpacity style={styles.introBtn} onPress={() => setSheet('add')} activeOpacity={0.7}>
                    <View style={styles.introBtnCircle}><UserPlus size={17} color={C.white} /></View>
                    <Text style={styles.introBtnText}>Add</Text>
                  </TouchableOpacity>
                  {isCreator && (
                    <TouchableOpacity style={styles.introBtn} onPress={() => setSheet('rename')} activeOpacity={0.7}>
                      <View style={styles.introBtnCircle}><Pencil size={17} color={C.white} /></View>
                      <Text style={styles.introBtnText}>Name</Text>
                    </TouchableOpacity>
                  )}
                  <TouchableOpacity style={styles.introBtn} onPress={() => setSheet('members')} activeOpacity={0.7}>
                    <View style={styles.introBtnCircle}><Users size={17} color={C.white} /></View>
                    <Text style={styles.introBtnText}>Members</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : null}
            renderItem={({ item }) => {
              if (item.type === 'date') return <MessageDateDivider label={item.label} />
              // A group event is a centered line, never a speech bubble.
              if (item.msg.kind === 'system') return (
                <Text style={styles.eventLine}>{groupEventText(item.msg, currentUserId, memberName)}</Text>
              )
              const isMine = item.msg.sender_id === currentUserId
              const seenHere = seenAt[item.msg.id] ?? []
              return (
                <MessageItem
                  msg={item.msg}
                  isMine={isMine}
                  currentUserId={currentUserId}
                  senderName={senderLabel(item.msg.sender_id)}
                  showName={item.showName}
                  initials={initialsOf(memberName(item.msg.sender_id))}
                  time={formatMsgTime(item.msg.sent_at)}
                  seen={isMine ? seenByAll(item.msg) : undefined}
                  replyName={item.msg.reply_to ? memberName(item.msg.reply_to.sender_id) : undefined}
                  onLongPress={setPickerMsgId}
                  onReact={handleReact}
                  onReply={() => setReplyTo(item.msg)}
                  footer={seenHere.length > 0 ? (
                    <View style={bS.seenRow}>
                      {seenHere.slice(0, 3).map(m => (
                        <View key={m.user_id} style={bS.seenAvatar}>
                          <Text style={bS.seenAvatarText}>{m.first_name[0]?.toUpperCase() ?? '?'}</Text>
                        </View>
                      ))}
                      {seenHere.length > 3 && <Text style={bS.seenOverflow}>+{seenHere.length - 3}</Text>}
                    </View>
                  ) : undefined}
                />
              )
            }}
          />
        )}

        {typingLabel && (
          <View style={styles.typingRow}>
            <TypingMessage name={typingLabel} icon={<Users size={14} color="rgba(255,255,255,0.55)" />} />
          </View>
        )}

        {myStatus === 'accepted' && (
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
            replyTo={replyTo ? { name: replyTo.sender_id === currentUserId ? 'yourself' : memberName(replyTo.sender_id), content: replyTo.content } : null}
            onCancelReply={() => setReplyTo(null)}
          mention={mention}
          showJumpToLatest={!stick.atEnd}
          onJumpToLatest={() => stick.jumpToEnd()}
          />
        )}

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
          const mine = messages.some(m => m.id === id && m.sender_id === currentUserId && m.kind !== 'system')
          // Let the long-press sheet finish closing first; iOS drops an alert opened mid-dismiss.
          setTimeout(() => chooseMessageRemoval(mine, (scope) => { void handleDelete(id, scope) }), 300)
        }}
      />

      <GroupSheets
        view={sheet}
        groupId={groupId ?? ''}
        groupName={name}
        createdBy={createdBy}
        currentUserId={currentUserId}
        canAct={myStatus === 'accepted'}
        members={members}
        requests={requests}
        onView={setSheet}
        onClose={() => setSheet(null)}
        onChanged={loadGroup}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  eventLine: {
    fontFamily:       FONTS.alegreyaSans.regular,
    alignSelf:        'center',
    textAlign:        'center',
    fontSize:         12,
    lineHeight:       17,
    color:            'rgba(255,255,255,0.45)',
    paddingHorizontal: 28,
    paddingVertical:  8,
  },
  root:     { flex: 1, backgroundColor: C.bg },
  flex:     { flex: 1 },

  header:       { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 12, paddingVertical: 12, backgroundColor: C.bg, borderBottomWidth: 1, borderBottomColor: C.border },
  backBtn:      { padding: 8, borderRadius: 10 },
  headerCenter: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 },
  headerAvatar: { width: 38, height: 38, borderRadius: 19, backgroundColor: C.raised, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center' },
  headerName:   { color: C.white, fontFamily: FONTS.alegreyaSans.medium, fontSize: 15 },
  headerStatus: { color: C.muted, fontFamily: FONTS.alegreyaSans.regular, fontSize: 11, marginTop: 1 },
  headerStatusTyping: { color: C.cyan },

  listContent: { paddingHorizontal: 12, paddingVertical: 16, gap: 10 },

  requestBar:     { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 10, backgroundColor: 'rgba(77,249,237,0.07)', borderBottomWidth: 1, borderBottomColor: C.border },
  requestBarText: { flex: 1, color: 'rgba(255,255,255,0.85)', fontFamily: FONTS.alegreyaSans.regular, fontSize: 13 },
  requestBarLink: { color: C.cyan, fontFamily: FONTS.alegreyaSans.medium, fontSize: 13 },

  intro:          { alignItems: 'center', paddingTop: 12, paddingBottom: 22, gap: 4 },
  introAvatar:    { width: 64, height: 64, borderRadius: 32, backgroundColor: C.raised, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center', marginBottom: 6 },
  introName:      { color: C.white, fontFamily: FONTS.alegreyaSans.bold, fontSize: 17, textAlign: 'center' },
  introSub:       { color: C.muted, fontFamily: FONTS.alegreyaSans.regular, fontSize: 12 },
  introBtns:      { flexDirection: 'row', gap: 26, marginTop: 12 },
  introBtn:       { alignItems: 'center', gap: 6 },
  introBtnCircle: { width: 42, height: 42, borderRadius: 21, backgroundColor: 'rgba(255,255,255,0.08)', alignItems: 'center', justifyContent: 'center' },
  introBtnText:   { color: 'rgba(255,255,255,0.7)', fontFamily: FONTS.alegreyaSans.regular, fontSize: 12 },
  center:      { flex: 1, alignItems: 'center', justifyContent: 'center' },
  declinedText: { color: C.muted, fontFamily: FONTS.alegreyaSans.regular, fontSize: 14 },

  typingRow:   { paddingHorizontal: 12, paddingVertical: 6 },

})
