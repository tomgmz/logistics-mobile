import React, { useState, useEffect, useCallback, useRef } from 'react'
import {
  View, Text, FlatList, TouchableOpacity,
  TextInput, ActivityIndicator, RefreshControl,
  StyleSheet, Animated,
} from 'react-native'
import { useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Search, Users, MessageCircle } from 'lucide-react-native'
import { useAuthStore } from '../../../lib/store/auth.store'
import { messagingApi } from '../../../lib/api/messaging.api'
import { useMessagingRealtime } from '../../../hooks/useMessagingRealtime'
import { useMessagingStore } from '../../../lib/store/messaging.store'
import type {
  ConversationWithDetails, GroupRaw, MessageRow, GroupMessageRaw,
} from '../../../types/messaging.types'

const C = {
  bg:        '#0a0a0a',
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

// ─── Helpers ──────────────────────────────────────────────────────────────────

const PHT = 'Asia/Manila'

// Parse postgres UTC timestamps (may lack Z suffix)
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

// ─── Types ────────────────────────────────────────────────────────────────────

type UnifiedItem =
  | { kind: 'dm';    data: ConversationWithDetails; lastAt: string }
  | { kind: 'group'; data: GroupRaw;                 lastAt: string }

// ─── DM row ───────────────────────────────────────────────────────────────────

function DmRow({ item, currentUserId, onPress, index }: {
  item: ConversationWithDetails
  currentUserId: string
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

  return (
    <Animated.View style={{ opacity: fadeAnim, transform: [{ translateY: slideAnim }] }}>
      <TouchableOpacity onPress={onPress} activeOpacity={0.75} style={styles.row}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{initials(u.first_name, u.last_name)}</Text>
        </View>

        <View style={styles.rowBody}>
          <View style={styles.rowTop}>
            <Text style={[styles.rowName, hasUnread && styles.rowNameUnread]} numberOfLines={1}>
              {u.first_name} {u.last_name}
            </Text>
            {last && (
              <Text style={styles.rowTime}>{formatTime(last.sent_at)}</Text>
            )}
          </View>
          <View style={styles.rowBottom}>
            <Text style={[styles.rowPreview, hasUnread && styles.rowPreviewUnread]} numberOfLines={1}>
              {isMyLast && <Text style={styles.youPrefix}>You: </Text>}
              {last?.content ?? 'No messages yet'}
            </Text>
            {hasUnread && (
              <View style={styles.badge}>
                <Text style={styles.badgeText}>
                  {item.unread_count > 9 ? '9+' : item.unread_count}
                </Text>
              </View>
            )}
          </View>
        </View>
      </TouchableOpacity>
    </Animated.View>
  )
}

// ─── Group row ────────────────────────────────────────────────────────────────

function GroupRow({ item, onPress, index }: {
  item: GroupRaw
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

  return (
    <Animated.View style={{ opacity: fadeAnim, transform: [{ translateY: slideAnim }] }}>
      <TouchableOpacity onPress={onPress} activeOpacity={0.75} style={styles.row}>
        <View style={[styles.avatar, styles.groupAvatar]}>
          {isPending && <View style={styles.pendingDot} />}
          <Users size={17} color={C.muted} />
        </View>

        <View style={styles.rowBody}>
          <View style={styles.rowTop}>
            <Text style={[styles.rowName, hasUnread && styles.rowNameUnread]} numberOfLines={1}>
              {item.name}
            </Text>
            {last && <Text style={styles.rowTime}>{formatTime(last.sent_at)}</Text>}
          </View>
          <View style={styles.rowBottom}>
            <Text style={[styles.rowPreview, hasUnread && styles.rowPreviewUnread]} numberOfLines={1}>
              {isPending
                ? <Text style={styles.pendingText}>Invite pending</Text>
                : last?.content ?? `${count} member${count !== 1 ? 's' : ''}`}
            </Text>
            {hasUnread && (
              <View style={styles.badge}>
                <Text style={styles.badgeText}>
                  {item.unread_count > 9 ? '9+' : item.unread_count}
                </Text>
              </View>
            )}
          </View>
        </View>
      </TouchableOpacity>
    </Animated.View>
  )
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function MessagesScreen() {
  const router        = useRouter()
  const insets        = useSafeAreaInsets()
  const { user }      = useAuthStore()
  const currentUserId = user?.user_id ?? ''
  const { setTotalUnread, incrementUnread, decrementUnread } = useMessagingStore()

  const [conversations, setConversations] = useState<ConversationWithDetails[]>([])
  const [groups,        setGroups]        = useState<GroupRaw[]>([])
  const [loading,       setLoading]       = useState(true)
  const [refreshing,    setRefreshing]    = useState(false)
  const [search,        setSearch]        = useState('')

  const fetchAll = useCallback(async () => {
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

  useMessagingRealtime({
    currentUserId,
    onNewMessage: (raw: MessageRow) => {
      const isMyMsg = raw.sender_id === currentUserId
      setConversations(prev => prev.map(c => {
        if (c.conversation_id !== raw.conversation_id) return c
        if (isMyMsg && c.unread_count > 0) decrementUnread(c.unread_count)
        else if (!isMyMsg) incrementUnread()
        return {
          ...c,
          last_message: { message_id: raw.message_id, content: raw.content, sent_at: raw.sent_at, sender_id: raw.sender_id },
          unread_count: isMyMsg ? 0 : c.unread_count + 1,
        }
      }))
    },
    onGroupMessage: (raw: GroupMessageRaw) => {
      const isMyMsg = raw.sender_id === currentUserId
      setGroups(prev => prev.map(g => {
        if (g.group_id !== raw.group_id) return g
        if (isMyMsg && g.unread_count > 0) decrementUnread(g.unread_count)
        else if (!isMyMsg) incrementUnread()
        return {
          ...g,
          last_message: { message_id: raw.message_id, content: raw.content, sent_at: raw.sent_at, sender_id: raw.sender_id },
          unread_count: isMyMsg ? 0 : g.unread_count + 1,
        }
      }))
    },
    onGroupInvite: () => fetchAll(),
  })

  // ── Build unified sorted list ──────────────────────────────────────────────
  const q = search.toLowerCase()

  const unified: UnifiedItem[] = [
    ...conversations
      .filter(c => {
        const u = c.other_user
        return `${u.first_name ?? ''} ${u.last_name ?? ''}`.toLowerCase().includes(q)
      })
      .map(c => ({ kind: 'dm' as const, data: c, lastAt: c.last_message?.sent_at ?? c.created_at })),
    ...groups
      .filter(g => g.name.toLowerCase().includes(q))
      .map(g => ({ kind: 'group' as const, data: g, lastAt: g.last_message?.sent_at ?? g.created_at })),
  ].sort((a, b) => b.lastAt.localeCompare(a.lastAt))

  const totalUnread =
    conversations.reduce((s, c) => s + c.unread_count, 0) +
    groups.reduce((s, g) => s + g.unread_count, 0)

  return (
    <View style={[styles.container, { paddingTop: insets.top > 0 ? 0 : 8 }]}>
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.label}>Inbox</Text>
          <View style={styles.titleRow}>
            <Text style={styles.title}>Messages</Text>
            {totalUnread > 0 && (
              <View style={styles.totalBadge}>
                <Text style={styles.totalBadgeText}>{totalUnread > 99 ? '99+' : totalUnread}</Text>
              </View>
            )}
          </View>
        </View>
      </View>

      {/* Search */}
      <View style={styles.searchWrap}>
        <Search size={14} color={C.muted} style={styles.searchIcon} />
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Search conversations…"
          placeholderTextColor="rgba(255,255,255,0.22)"
          style={styles.searchInput}
        />
      </View>

      {/* Separator */}
      <View style={styles.sep} />

      {/* List */}
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="small" color={C.cyan} />
        </View>
      ) : (
        <FlatList
          data={unified}
          keyExtractor={item => item.kind === 'dm' ? `dm-${item.data.conversation_id}` : `g-${item.data.group_id}`}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchAll() }} tintColor={C.cyan} />
          }
          contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
          ListEmptyComponent={
            <View style={styles.center}>
              <MessageCircle size={36} color="rgba(255,255,255,0.12)" />
              <Text style={styles.emptyText}>
                {search ? 'No conversations match your search' : 'No conversations yet'}
              </Text>
            </View>
          }
          renderItem={({ item, index }) =>
            item.kind === 'dm' ? (
              <DmRow
                item={item.data}
                currentUserId={currentUserId}
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
                      participantId: item.data.other_user.user_id,
                    },
                  })
                }}
              />
            ) : (
              <GroupRow
                item={item.data}
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
    </View>
  )
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex:            1,
    backgroundColor: C.bg,
  },
  header: {
    paddingHorizontal: 20,
    paddingTop:        12,
    paddingBottom:     12,
  },
  label: {
    color:         C.muted,
    fontSize:      10,
    fontWeight:    '700',
    letterSpacing: 2.5,
    textTransform: 'uppercase',
    marginBottom:  2,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems:    'center',
    gap:           10,
  },
  title: {
    color:      C.white,
    fontSize:   28,
    fontWeight: '900',
    letterSpacing: -0.5,
  },
  totalBadge: {
    backgroundColor: C.cyan,
    borderRadius:    14,
    minWidth:        28,
    height:          28,
    alignItems:      'center',
    justifyContent:  'center',
    paddingHorizontal: 6,
  },
  totalBadgeText: {
    color:      C.bg,
    fontSize:   12,
    fontWeight: '800',
  },
  searchWrap: {
    flexDirection:     'row',
    alignItems:        'center',
    marginHorizontal:  16,
    marginBottom:      12,
    backgroundColor:   C.raised,
    borderRadius:      12,
    borderWidth:       1,
    borderColor:       C.border,
    paddingHorizontal: 12,
    height:            42,
  },
  searchIcon: {
    marginRight: 8,
  },
  searchInput: {
    flex:      1,
    color:     C.white,
    fontSize:  14,
    paddingVertical: 0,
  },
  sep: {
    height:          1,
    backgroundColor: C.border,
    marginHorizontal: 16,
    marginBottom:    4,
  },
  center: {
    flex:           1,
    alignItems:     'center',
    justifyContent: 'center',
    paddingVertical: 60,
    gap:            12,
  },
  emptyText: {
    color:     C.muted,
    fontSize:  13,
    textAlign: 'center',
  },

  // Row
  row: {
    flexDirection:     'row',
    alignItems:        'center',
    gap:               12,
    paddingHorizontal: 16,
    paddingVertical:   12,
  },
  avatar: {
    width:           44,
    height:          44,
    borderRadius:    22,
    backgroundColor: C.raised,
    borderWidth:     1,
    borderColor:     C.border,
    alignItems:      'center',
    justifyContent:  'center',
    flexShrink:      0,
  },
  groupAvatar: {
    position: 'relative',
  },
  avatarText: {
    color:      C.white,
    fontSize:   14,
    fontWeight: '700',
  },
  pendingDot: {
    position:        'absolute',
    top:             -1,
    right:           -1,
    width:           12,
    height:          12,
    borderRadius:    6,
    backgroundColor: '#f59e0b',
    borderWidth:     2,
    borderColor:     C.bg,
    zIndex:          1,
  },
  rowBody: {
    flex: 1,
  },
  rowTop: {
    flexDirection:  'row',
    alignItems:     'center',
    justifyContent: 'space-between',
    gap:            8,
    marginBottom:   3,
  },
  rowName: {
    flex:       1,
    color:      'rgba(255,255,255,0.75)',
    fontSize:   14,
    fontWeight: '500',
  },
  rowNameUnread: {
    color:      C.white,
    fontWeight: '700',
  },
  rowTime: {
    color:     C.muted,
    fontSize:  11,
    flexShrink: 0,
  },
  rowBottom: {
    flexDirection:  'row',
    alignItems:     'center',
    justifyContent: 'space-between',
    gap:            8,
  },
  rowPreview: {
    flex:       1,
    color:      'rgba(255,255,255,0.28)',
    fontSize:   12,
  },
  rowPreviewUnread: {
    color: 'rgba(255,255,255,0.55)',
  },
  youPrefix: {
    color: 'rgba(77,249,237,0.5)',
  },
  pendingText: {
    color: '#f59e0b',
  },
  badge: {
    backgroundColor: C.cyan,
    borderRadius:    9,
    minWidth:        18,
    height:          18,
    alignItems:      'center',
    justifyContent:  'center',
    paddingHorizontal: 4,
    flexShrink:      0,
  },
  badgeText: {
    color:      C.bg,
    fontSize:   10,
    fontWeight: '800',
    lineHeight: 12,
  },
})
