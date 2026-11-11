import React, { useState, useEffect, useCallback, useRef } from 'react'
import {
  View, Text, FlatList, TouchableOpacity,
  TextInput, ActivityIndicator, RefreshControl,
  StyleSheet, Animated,
} from 'react-native'
import { useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Search, MessageCircle, Plus, ChevronLeft } from 'lucide-react-native'
import { useNetInfo } from '@react-native-community/netinfo'
import { useCatchUp } from '../../../hooks/useLiveSignal'
import { useAuthStore } from '../../../lib/store/auth.store'
import { messagingApi } from '../../../lib/api/messaging.api'
import { useMessagingRealtime } from '../../../hooks/useMessagingRealtime'
import { useMessagingStore } from '../../../lib/store/messaging.store'
import ComposeModal from '../../../components/messaging/ComposeModal'
import { matchesPersonSearch, nameWithRole } from '../../../lib/roles'
import type {
  ConversationWithDetails, GroupRaw, MessageRow, GroupMessageRaw, MessagableUser,
} from '../../../types/messaging.types'
import { FONTS } from '../../../lib/config/fonts'

const C = {
  bg:        '#000000',
  field:     '#111212',
  ring:      '#5a5a5a',
  teal:      '#073b38',
  green:     '#3af626',
  card:      '#141414',
  raised:    '#1a1a1a',
  elevated:  '#1e1e1e',
  border:    '#2a2a2a',
  cyan:      '#4df9ed',
  cyanDim:   'rgba(77,249,237,0.12)',
  white:     '#ffffff',
  muted:     '#818181',
  overlay:   'rgba(255,255,255,0.07)',
}

const PHT = 'Asia/Manila'

function parsePHT(iso: string): Date {
  const utc = iso.endsWith('Z') || iso.includes('+') ? iso : `${iso}Z`
  return new Date(utc)
}

function formatTime(iso: string): string {
  const d    = parsePHT(iso)
  const now  = new Date()
  const diff = now.getTime() - d.getTime()
  const mins = Math.floor(diff / 60_000)
  const hrs  = Math.floor(diff / 3_600_000)
  const days = Math.floor(diff / 86_400_000)
  if (mins < 1)  return 'now'
  if (mins < 60) return `${mins}m`
  if (hrs  < 24) return `${hrs}h`
  if (days < 7)  return `${days}d`
  return d.toLocaleDateString('en-PH', { month: 'short', day: 'numeric', timeZone: PHT })
}

function initials(first: string | null, last: string | null): string {
  return `${first?.[0] ?? '?'}${last?.[0] ?? ''}`.toUpperCase()
}

type UnifiedItem =
  | { kind: 'dm';    data: ConversationWithDetails; lastAt: string }
  | { kind: 'group'; data: GroupRaw;                 lastAt: string }

function DmRow({ item, currentUserId, isOnline, onPress, index }: {
  item: ConversationWithDetails
  currentUserId: string
  isOnline: boolean
  onPress: () => void
  index: number
}) {
  const fadeAnim = useRef(new Animated.Value(0)).current
  const slideAnim = useRef(new Animated.Value(14)).current

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim,  { toValue: 1, duration: 260, delay: index * 40, useNativeDriver: true }),
      Animated.timing(slideAnim, { toValue: 0, duration: 260, delay: index * 40, useNativeDriver: true }),
    ]).start()
  }, [])

  const u         = item.other_user
  const last      = item.last_message
  const hasUnread = item.unread_count > 0
  const isMyLast  = last?.sender_id === currentUserId

  const senderFirst = !isMyLast && last ? (u.first_name ?? '') : ''
  const preview = last
    ? (isMyLast ? `You: ${last.content}` : hasUnread && senderFirst ? `${senderFirst}: ${last.content}` : last.content)
    : 'No messages yet'

  return (
    <Animated.View style={{ opacity: fadeAnim, transform: [{ translateY: slideAnim }] }}>
      <TouchableOpacity onPress={onPress} activeOpacity={0.75} style={styles.row}>
        <View style={[styles.avatar, hasUnread && styles.avatarUnread]}>
          <Text style={styles.avatarText}>{initials(u.first_name, u.last_name)}</Text>
          {isOnline && <View style={styles.onlineDot} />}
        </View>

        <View style={styles.rowBody}>
          <View style={styles.rowTop}>
            <Text style={[styles.rowName, hasUnread && styles.rowNameUnread]} numberOfLines={1}>
              {nameWithRole(u.first_name, u.last_name, u.role)}
            </Text>
            {last && <Text style={styles.rowTime}>{formatTime(last.sent_at)}</Text>}
          </View>
          <Text style={[styles.rowPreview, hasUnread && styles.rowPreviewUnread]} numberOfLines={1}>
            {preview}
          </Text>
        </View>
      </TouchableOpacity>
    </Animated.View>
  )
}

function GroupRow({ item, currentUserId, onPress, index }: {
  item: GroupRaw
  currentUserId: string
  onPress: () => void
  index: number
}) {
  const fadeAnim  = useRef(new Animated.Value(0)).current
  const slideAnim = useRef(new Animated.Value(14)).current

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim,  { toValue: 1, duration: 260, delay: index * 40, useNativeDriver: true }),
      Animated.timing(slideAnim, { toValue: 0, duration: 260, delay: index * 40, useNativeDriver: true }),
    ]).start()
  }, [])

  const last      = item.last_message
  const hasUnread = item.unread_count > 0
  const isPending = item.my_status === 'pending'
  const count     = item.members.filter(m => m.status === 'accepted').length

  const groupInitials = item.name.trim().split(/\s+/).slice(0, 2).map(w => w[0] ?? '').join('').toUpperCase() || 'G'
  const preview = isPending
    ? null
    : last
      ? (last.sender_id === currentUserId ? `You: ${last.content}` : last.content)
      : `${count} member${count !== 1 ? 's' : ''}`

  return (
    <Animated.View style={{ opacity: fadeAnim, transform: [{ translateY: slideAnim }] }}>
      <TouchableOpacity onPress={onPress} activeOpacity={0.75} style={styles.row}>
        <View style={[styles.avatar, (hasUnread || isPending) && styles.avatarUnread]}>
          {isPending && <View style={styles.pendingDot} />}
          <Text style={styles.avatarText}>{groupInitials}</Text>
        </View>

        <View style={styles.rowBody}>
          <View style={styles.rowTop}>
            <Text style={[styles.rowName, (hasUnread || isPending) && styles.rowNameUnread]} numberOfLines={1}>
              {item.name}
            </Text>
            {last && <Text style={styles.rowTime}>{formatTime(last.sent_at)}</Text>}
          </View>
          <Text style={[styles.rowPreview, hasUnread && styles.rowPreviewUnread]} numberOfLines={1}>
            {isPending ? <Text style={styles.pendingText}>Invite pending</Text> : preview}
          </Text>
        </View>
      </TouchableOpacity>
    </Animated.View>
  )
}

export default function MessagesScreen() {
  const router        = useRouter()
  const insets        = useSafeAreaInsets()
  const { user }      = useAuthStore()
  const currentUserId = user?.user_id ?? ''
  const { setTotalUnread, incrementUnread, decrementUnread } = useMessagingStore()
  const onlineUserIds = useMessagingStore(s => s.onlineUserIds)

  const [conversations, setConversations] = useState<ConversationWithDetails[]>([])
  const [groups,        setGroups]        = useState<GroupRaw[]>([])
  const [loading,       setLoading]       = useState(true)
  const [refreshing,    setRefreshing]    = useState(false)
  const [search,        setSearch]        = useState('')
  const [composeOpen,   setComposeOpen]   = useState(false)
  const [nowTick,       setNowTick]       = useState(0)
  const [tab,           setTab]           = useState<'direct' | 'groups'>('direct')
  // The ONLINE pill: whether this phone has a connection, so messages arrive
  // live (null while unknown counts as online, as the offline queue does).
  const netInfo = useNetInfo()
  const isOnlineNow = netInfo.isConnected !== false

  useEffect(() => {
    const id = setInterval(() => setNowTick(t => t + 1), 60_000)
    return () => clearInterval(id)
  }, [])

  const fetchAll = useCallback(async () => {
    // This session's inbox shows at once; the fresh read below replaces it.
    const keptConvs  = messagingApi.peekConversations()
    const keptGroups = messagingApi.peekGroups()
    if (keptConvs && keptGroups) {
      setConversations(prev => (prev.length ? prev : keptConvs))
      setGroups(prev => (prev.length ? prev : keptGroups))
      setLoading(false)
    }
    try {
      const [rawConvs, rawGroups] = await Promise.all([
        messagingApi.getConversations(),
        messagingApi.getGroups(),
      ])
      setConversations(rawConvs)
      setGroups(rawGroups)
      setTotalUnread(
        rawConvs.reduce((s, c) => s + c.unread_count, 0) +
        rawGroups.reduce((s, g) => s + g.unread_count, 0)
      )
    } catch { /* silent */ }
    finally { setLoading(false); setRefreshing(false) }
  }, [setTotalUnread])

  useEffect(() => { fetchAll() }, [fetchAll])
  // Back from the background or offline: changes made meanwhile never arrived live.
  useCatchUp(() => { void fetchAll() })

  useMessagingRealtime({
    currentUserId,
    onNewMessage: (raw: MessageRow) => {
      const isMyMsg = raw.sender_id === currentUserId
      let known = false
      setConversations(prev => {
        known = prev.some(c => c.conversation_id === raw.conversation_id)
        return prev.map(c => {
          if (c.conversation_id !== raw.conversation_id) return c
          if (isMyMsg && c.unread_count > 0) decrementUnread(c.unread_count)
          else if (!isMyMsg) incrementUnread()
          return {
            ...c,
            last_message: { message_id: raw.message_id, content: raw.content, sent_at: raw.sent_at, sender_id: raw.sender_id },
            unread_count: isMyMsg ? 0 : c.unread_count + 1,
          }
        })
      })
      if (!known) fetchAll()
    },
    onGroupMessage: (raw: GroupMessageRaw) => {
      const isMyMsg = raw.sender_id === currentUserId
      // A group event line (renamed, people added) is never unread, like on the web.
      const isEvent = raw.message_type === 'system'
      let known = false
      setGroups(prev => {
        known = prev.some(g => g.group_id === raw.group_id)
        return prev.map(g => {
          if (g.group_id !== raw.group_id) return g
          if (isMyMsg && g.unread_count > 0) decrementUnread(g.unread_count)
          else if (!isMyMsg && !isEvent) incrementUnread()
          return {
            ...g,
            last_message: { message_id: raw.message_id, content: raw.content, sent_at: raw.sent_at, sender_id: raw.sender_id },
            unread_count: isMyMsg ? 0 : isEvent ? g.unread_count : g.unread_count + 1,
          }
        })
      })
      if (!known) fetchAll()
    },
    onGroupInvite: () => fetchAll(),
    // Renamed, members changed, or someone was removed: reload the list.
    onGroupUpdated: () => fetchAll(),
    onMessageUnsent: () => fetchAll(),
  })

  const q = search.toLowerCase()

  // DIRECT and GROUPS are separate tabs (Figma), each newest first.
  const unified: UnifiedItem[] = (tab === 'direct'
    ? conversations
        // By name or role, e.g. "company administrator".
        .filter(c => matchesPersonSearch(search, c.other_user))
        .map(c => ({ kind: 'dm' as const, data: c, lastAt: c.last_message?.sent_at ?? c.created_at }))
    : groups
        .filter(g => g.name.toLowerCase().includes(q.trim()))
        .map(g => ({ kind: 'group' as const, data: g, lastAt: g.last_message?.sent_at ?? g.created_at }))
  ).sort((a, b) => b.lastAt.localeCompare(a.lastAt))

  const totalUnread =
    conversations.reduce((s, c) => s + c.unread_count, 0) +
    groups.reduce((s, g) => s + g.unread_count, 0)

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} activeOpacity={0.7} style={styles.backBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <ChevronLeft size={22} color={C.white} />
        </TouchableOpacity>
        <Text style={styles.title} numberOfLines={1}>MESSAGES</Text>
        <View style={[styles.statusPill, !isOnlineNow && styles.statusPillOff]}>
          <View style={[styles.statusDot, !isOnlineNow && styles.statusDotOff]} />
          <Text style={[styles.statusText, !isOnlineNow && styles.statusTextOff]}>{isOnlineNow ? 'ONLINE' : 'OFFLINE'}</Text>
        </View>
      </View>

      {/* Search */}
      <View style={styles.searchWrap}>
        <Search size={18} color={C.muted} style={styles.searchIcon} />
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Search Conversations"
          placeholderTextColor="rgba(255,255,255,0.4)"
          style={styles.searchInput}
        />
      </View>

      {/* Dashed separator */}
      <View style={styles.sep} />

      {/* DIRECT / GROUPS */}
      <View style={styles.tabs}>
        {(['direct', 'groups'] as const).map(t => {
          const active = tab === t
          const unread = t === 'direct'
            ? conversations.reduce((n, c) => n + c.unread_count, 0)
            : groups.reduce((n, g) => n + g.unread_count, 0) + groups.filter(g => g.my_status === 'pending').length
          return (
            <TouchableOpacity key={t} onPress={() => setTab(t)} activeOpacity={0.8} style={[styles.tab, active && styles.tabActive]}>
              <Text style={styles.tabText}>{t === 'direct' ? 'DIRECT' : 'GROUPS'}</Text>
              {unread > 0 && !active && <View style={styles.tabDot} />}
            </TouchableOpacity>
          )
        })}
      </View>

      {/* List */}
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="small" color={C.cyan} />
        </View>
      ) : (
        <FlatList
          data={unified}
          keyExtractor={item => item.kind === 'dm' ? `dm-${item.data.conversation_id}` : `g-${item.data.group_id}`}
          extraData={`${nowTick}-${onlineUserIds.join(',')}`}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchAll() }} tintColor={C.cyan} />
          }
          contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
          ListEmptyComponent={
            <View style={styles.center}>
              <MessageCircle size={36} color="rgba(255,255,255,0.12)" />
              <Text style={styles.emptyText}>
                {search
                  ? 'No conversations match your search'
                  : tab === 'direct' ? 'No conversations yet' : 'No groups yet'}
              </Text>
            </View>
          }
          renderItem={({ item, index }) =>
            item.kind === 'dm' ? (
              <DmRow
                item={item.data}
                currentUserId={currentUserId}
                isOnline={onlineUserIds.includes(item.data.other_user.user_id)}
                index={index}
                onPress={() => {
                  if (item.data.unread_count > 0) decrementUnread(item.data.unread_count)
                  setConversations(prev => prev.map(c =>
                    c.conversation_id === item.data.conversation_id
                      ? { ...c, unread_count: 0 }
                      : c
                  ))
                  router.push({
                    pathname: '/driver/messages/[conversationId]',
                    params: {
                      conversationId: item.data.conversation_id,
                      participantName: `${item.data.other_user.first_name ?? ''} ${item.data.other_user.last_name ?? ''}`.trim(),
                      participantRole: item.data.other_user.role ?? '',
                      participantId: item.data.other_user.user_id,
                    },
                  })
                }}
              />
            ) : (
              <GroupRow
                item={item.data}
                currentUserId={currentUserId}
                index={index}
                onPress={() => {
                  if (item.data.unread_count > 0) decrementUnread(item.data.unread_count)
                  setGroups(prev => prev.map(g =>
                    g.group_id === item.data.group_id ? { ...g, unread_count: 0 } : g
                  ))
                  router.push({
                    pathname: '/driver/messages/group/[groupId]',
                    params: {
                      groupId:   item.data.group_id,
                      groupName: item.data.name,
                      myStatus:  item.data.my_status,
                    },
                  })
                }}
              />
            )
          }
        />
      )}

      {/* Compose FAB */}
      <TouchableOpacity
        activeOpacity={0.85}
        onPress={() => setComposeOpen(true)}
        style={[styles.fab, { bottom: insets.bottom + 20 }]}
      >
        <Plus size={26} color={C.cyan} strokeWidth={2.2} />
      </TouchableOpacity>

      <ComposeModal
        visible={composeOpen}
        onClose={() => setComposeOpen(false)}
        onConversationReady={(conversationId, u) => {
          setComposeOpen(false)
          fetchAll()
          router.push({
            pathname: '/driver/messages/[conversationId]',
            params: {
              conversationId: conversationId ?? 'new',
              participantName: `${u.first_name ?? ''} ${u.last_name ?? ''}`.trim(),
              participantRole: u.role ?? '',
              participantId: u.user_id,
              bookingId: u.booking_id ?? '',
            },
          })
        }}
        onGroupCreated={(groupId, name) => {
          setComposeOpen(false)
          fetchAll()
          router.push({
            pathname: '/driver/messages/group/[groupId]',
            params: { groupId, groupName: name, myStatus: 'accepted' },
          })
        }}
      />
    </View>
  )
}


// Darker Grotesque: the face in the Messages design (Figma, 2026-11-10). It
// has short letters, so sizes are set from the design's letter heights.
const DG = FONTS.darker

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },

  // Header: back circle, MESSAGES, connection pill
  header: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 19, paddingTop: 14, paddingBottom: 14,
  },
  backBtn: {
    width: 35, height: 35, borderRadius: 17.5,
    backgroundColor: C.field, borderWidth: 1, borderColor: '#2f2f2f',
    alignItems: 'center', justifyContent: 'center',
  },
  title: { flex: 1, color: C.white, fontSize: 36, fontFamily: DG.extraBold, letterSpacing: 0.4, lineHeight: 40 },
  statusPill: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 8, height: 18, borderRadius: 9,
    backgroundColor: 'rgba(58,246,38,0.12)', borderWidth: 1, borderColor: C.green,
  },
  statusPillOff: { backgroundColor: 'rgba(255,255,255,0.06)', borderColor: C.muted },
  statusDot:     { width: 6, height: 6, borderRadius: 3, backgroundColor: C.green },
  statusDotOff:  { backgroundColor: C.muted },
  statusText:    { color: C.green, fontSize: 13, fontFamily: DG.semiBold, letterSpacing: 0.3, lineHeight: 15 },
  statusTextOff: { color: C.muted },

  // Search
  searchWrap: {
    flexDirection: 'row', alignItems: 'center',
    marginHorizontal: 19, marginBottom: 9,
    backgroundColor: C.field, borderRadius: 18.5, borderWidth: 1, borderColor: '#2a2a2a',
    paddingHorizontal: 14, height: 37,
  },
  searchIcon: { marginRight: 10 },
  searchInput: { flex: 1, color: C.white, fontSize: 16, fontFamily: DG.medium, paddingVertical: 0 },

  // Dashed rule under the search
  sep: {
    marginHorizontal: 16, height: 0, borderTopWidth: 1, borderStyle: 'dashed', borderColor: 'rgba(255,255,255,0.35)',
  },

  // Tabs
  tabs: { flexDirection: 'row', marginHorizontal: 16, marginBottom: 14 },
  tab: {
    flex: 1, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 6,
    paddingTop: 10, paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: 'transparent',
  },
  tabActive: { borderBottomColor: C.cyan },
  tabText:   { color: C.white, fontSize: 15, fontFamily: DG.bold, letterSpacing: 0.4 },
  tabDot:    { width: 6, height: 6, borderRadius: 3, backgroundColor: C.cyan },

  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 60, gap: 12 },
  emptyText: { color: C.muted, fontSize: 16, fontFamily: DG.medium, textAlign: 'center' },

  // Row
  row: { flexDirection: 'row', alignItems: 'center', gap: 9, paddingHorizontal: 19, paddingVertical: 4.5 },
  avatar: {
    width: 35, height: 35, borderRadius: 17.5,
    backgroundColor: C.field, borderWidth: 1, borderColor: C.ring,
    alignItems: 'center', justifyContent: 'center', flexShrink: 0, position: 'relative',
  },
  avatarUnread: { borderWidth: 2, borderColor: C.cyan },
  avatarText: { color: C.white, fontSize: 15, fontFamily: DG.medium },
  onlineDot: {
    position: 'absolute', bottom: -1, right: -1, width: 10, height: 10, borderRadius: 5,
    backgroundColor: C.green, borderWidth: 2, borderColor: C.bg,
  },
  pendingDot: {
    position: 'absolute', top: -2, right: -2, width: 10, height: 10, borderRadius: 5,
    backgroundColor: '#ff7a30', borderWidth: 2, borderColor: C.bg, zIndex: 1,
  },
  rowBody: { flex: 1, gap: 2 },
  rowTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 },
  rowName: { flex: 1, color: C.white, fontSize: 18, fontFamily: DG.medium, lineHeight: 21 },
  rowNameUnread: { color: C.cyan, fontFamily: DG.bold },
  rowTime: { color: C.muted, fontSize: 12, fontFamily: DG.medium, flexShrink: 0, lineHeight: 15 },
  rowPreview: { color: C.muted, fontSize: 13, fontFamily: DG.medium, lineHeight: 15 },
  rowPreviewUnread: { color: C.white, fontFamily: DG.bold },
  pendingText: { color: '#ff7a30' },

  // + (new message)
  fab: {
    position: 'absolute', right: 16, width: 48, height: 48, borderRadius: 24,
    backgroundColor: C.teal, borderWidth: 2, borderColor: C.cyan,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: C.cyan, shadowOpacity: 0.35, shadowRadius: 10, shadowOffset: { width: 0, height: 3 }, elevation: 6,
  },
})
