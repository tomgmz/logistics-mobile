import React, { useCallback, useEffect, useState } from 'react'
import {
  View, Text, FlatList, TouchableOpacity,
  ActivityIndicator, RefreshControl, StyleSheet,
} from 'react-native'
import { useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { ArrowLeft, Bell, CheckCheck } from 'lucide-react-native'
import { useNotificationStore } from '../../../lib/store/notification.store'
import type { AppNotification } from '../../../lib/api/notification.api'

const C = {
  bg:     '#0a0a0a',
  raised: '#1a1a1a',
  border: '#2a2a2a',
  cyan:   '#4df9ed',
  white:  '#ffffff',
  muted:  '#818181',
}

function timeAgo(iso: string): string {
  const utc = iso.endsWith('Z') || iso.includes('+') ? iso : `${iso}Z`
  const diff = Date.now() - new Date(utc).getTime()
  const m = Math.floor(diff / 60_000)
  if (m < 1) return 'now'
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h`
  return `${Math.floor(h / 24)}d`
}

function NotifRow({ n, onPress }: { n: AppNotification; onPress: () => void }) {
  const isUnread = !n.read_at
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.75} style={styles.row}>
      <View style={styles.dotCol}>
        {isUnread ? <View style={styles.unreadDot} /> : <View style={styles.dotSpacer} />}
      </View>
      <View style={styles.rowBody}>
        <View style={styles.rowTop}>
          <Text style={[styles.rowTitle, isUnread && styles.rowTitleUnread]} numberOfLines={1}>
            {n.title}
          </Text>
          <Text style={styles.rowTime}>{timeAgo(n.created_at)}</Text>
        </View>
        <Text style={styles.rowBodyText} numberOfLines={2}>{n.body}</Text>
      </View>
    </TouchableOpacity>
  )
}

export default function NotificationsScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()

  const items       = useNotificationStore((s) => s.items)
  const unreadCount = useNotificationStore((s) => s.unreadCount)
  const loading     = useNotificationStore((s) => s.loading)
  const hydrate     = useNotificationStore((s) => s.hydrate)
  const markRead    = useNotificationStore((s) => s.markRead)
  const markAllRead = useNotificationStore((s) => s.markAllRead)

  const [refreshing, setRefreshing] = useState(false)

  useEffect(() => { hydrate() }, [hydrate])

  const onPressItem = useCallback((n: AppNotification) => {
    if (!n.read_at) markRead(n.notification_id)
    // Deep-link to the specific booking; fall back to the assignment list.
    const bookingId =
      n.booking_id ?? (typeof n.data?.booking_id === 'string' ? n.data.booking_id : null)
    if (bookingId) {
      router.push({ pathname: '/driver/maps/[bookingId]', params: { bookingId } })
    } else {
      router.push('/driver/driver-assignment')
    }
  }, [markRead, router])

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} activeOpacity={0.7} style={styles.backBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <ArrowLeft size={22} color={C.white} />
        </TouchableOpacity>
        <View style={styles.titleRow}>
          <Text style={styles.title}>Notifications</Text>
          {unreadCount > 0 && (
            <View style={styles.totalBadge}>
              <Text style={styles.totalBadgeText}>{unreadCount > 99 ? '99+' : unreadCount}</Text>
            </View>
          )}
        </View>
        {unreadCount > 0 && (
          <TouchableOpacity onPress={() => markAllRead()} activeOpacity={0.7} style={styles.markAllBtn}>
            <CheckCheck size={13} color={C.muted} />
            <Text style={styles.markAllText}>Mark all</Text>
          </TouchableOpacity>
        )}
      </View>

      <View style={styles.sep} />

      {loading && items.length === 0 ? (
        <View style={styles.center}><ActivityIndicator size="small" color={C.cyan} /></View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(n) => n.notification_id}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await hydrate(); setRefreshing(false) }} tintColor={C.cyan} />
          }
          contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
          ItemSeparatorComponent={() => <View style={styles.itemSep} />}
          ListEmptyComponent={
            <View style={styles.center}>
              <Bell size={36} color="rgba(255,255,255,0.12)" />
              <Text style={styles.emptyText}>No notifications yet</Text>
            </View>
          }
          renderItem={({ item }) => <NotifRow n={item} onPress={() => onPressItem(item)} />}
        />
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 16, paddingTop: 12, paddingBottom: 12,
  },
  backBtn: { padding: 4, borderRadius: 8 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  title: { color: C.white, fontSize: 26, fontWeight: '900', letterSpacing: -0.5 },
  totalBadge: {
    backgroundColor: C.cyan, borderRadius: 13, minWidth: 26, height: 26,
    alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6,
  },
  totalBadgeText: { color: C.bg, fontSize: 12, fontWeight: '800' },
  markAllBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    borderWidth: 1, borderColor: C.border, borderRadius: 10,
    paddingHorizontal: 10, paddingVertical: 6,
  },
  markAllText: { color: C.muted, fontSize: 11, fontWeight: '600' },
  sep: { height: 1, backgroundColor: C.border, marginHorizontal: 16, marginBottom: 4 },
  itemSep: { height: 1, backgroundColor: 'rgba(255,255,255,0.05)', marginLeft: 40 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 60, gap: 12 },
  emptyText: { color: C.muted, fontSize: 13, textAlign: 'center' },
  row: { flexDirection: 'row', gap: 10, paddingHorizontal: 16, paddingVertical: 14 },
  dotCol: { paddingTop: 5 },
  unreadDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: C.cyan },
  dotSpacer: { width: 8, height: 8 },
  rowBody: { flex: 1 },
  rowTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 3 },
  rowTitle: { flex: 1, color: 'rgba(255,255,255,0.7)', fontSize: 14, fontWeight: '600' },
  rowTitleUnread: { color: C.white, fontWeight: '800' },
  rowTime: { color: C.muted, fontSize: 11, flexShrink: 0 },
  rowBodyText: { color: 'rgba(255,255,255,0.4)', fontSize: 12, lineHeight: 17 },
})
