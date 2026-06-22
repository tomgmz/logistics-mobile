import { create } from 'zustand'
import { notificationApi, AppNotification } from '../api/notification.api'

interface NotificationStore {
  items:       AppNotification[]
  unreadCount: number
  loading:     boolean
  hydrate:     () => Promise<void>
  pushNew:     (n: AppNotification) => void
  markRead:    (id: string) => Promise<void>
  markAllRead: () => Promise<void>
}

export const useNotificationStore = create<NotificationStore>((set, get) => ({
  items:       [],
  unreadCount: 0,
  loading:     false,

  hydrate: async () => {
    set({ loading: true })
    try {
      const [items, unreadCount] = await Promise.all([
        notificationApi.list({ limit: 50 }),
        notificationApi.unreadCount(),
      ])
      set({ items, unreadCount })
    } catch {
      /* silent */
    } finally {
      set({ loading: false })
    }
  },

  pushNew: (n) => {
    const { items } = get()
    if (items.some((i) => i.notification_id === n.notification_id)) return
    set({ items: [n, ...items], unreadCount: get().unreadCount + (n.read_at ? 0 : 1) })
  },

  markRead: async (id) => {
    const target = get().items.find((i) => i.notification_id === id)
    if (!target || target.read_at) return
    set({
      items: get().items.map((i) =>
        i.notification_id === id ? { ...i, read_at: new Date().toISOString() } : i,
      ),
      unreadCount: Math.max(0, get().unreadCount - 1),
    })
    try {
      await notificationApi.markRead(id)
    } catch {
      get().hydrate()
    }
  },

  markAllRead: async () => {
    const nowIso = new Date().toISOString()
    set({
      items: get().items.map((i) => (i.read_at ? i : { ...i, read_at: nowIso })),
      unreadCount: 0,
    })
    try {
      await notificationApi.markAllRead()
    } catch {
      get().hydrate()
    }
  },
}))
