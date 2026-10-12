import { create } from 'zustand'
import { notificationApi, AppNotification, normalizeNotification } from '../api/notification.api'

/** Notifications per page on the notifications screen. */
export const NOTIFICATIONS_PAGE_SIZE = 10

interface NotificationStore {
  /** The current page's notifications. */
  items:       AppNotification[]
  unreadCount: number
  loading:     boolean
  page:        number
  total:       number
  totalPages:  number
  pageLoading: boolean
  /** Reload the current page (page 1 on first load) and the unread count. */
  hydrate:     () => Promise<void>
  goToPage:    (page: number) => Promise<void>
  pushNew:     (n: AppNotification) => void
  markRead:    (id: string) => Promise<void>
  markAllRead: () => Promise<void>
}

export const useNotificationStore = create<NotificationStore>((set, get) => ({
  items:       [],
  unreadCount: 0,
  loading:     false,
  page:        1,
  total:       0,
  totalPages:  1,
  pageLoading: false,

  hydrate: async () => {
    set({ loading: true })
    try {
      const [res, unreadCount] = await Promise.all([
        notificationApi.page(get().page, NOTIFICATIONS_PAGE_SIZE),
        notificationApi.unreadCount(),
      ])
      // The page emptied (notifications went away): step back to the last one.
      if (res.items.length === 0 && get().page > 1) {
        set({ page: Math.max(1, res.totalPages) })
        set({ loading: false })
        return get().hydrate()
      }
      set({ items: res.items, total: res.total, totalPages: res.totalPages, unreadCount })
    } catch {
      /* silent */
    } finally {
      set({ loading: false })
    }
  },

  goToPage: async (page) => {
    set({ pageLoading: true })
    try {
      const res = await notificationApi.page(page, NOTIFICATIONS_PAGE_SIZE)
      set({ page, items: res.items, total: res.total, totalPages: res.totalPages })
    } catch {
      /* stay on the current page */
    } finally {
      set({ pageLoading: false })
    }
  },

  // A new notification joins the top of page 1; on a later page only the
  // counts move, so the page being read doesn't shift.
  pushNew: (raw) => {
    const n = normalizeNotification(raw)
    const { items, page, total } = get()
    if (items.some((i) => i.notification_id === n.notification_id)) return
    const nextTotal = total + 1
    set({
      items:       page === 1 ? [n, ...items].slice(0, NOTIFICATIONS_PAGE_SIZE) : items,
      total:       nextTotal,
      totalPages:  Math.max(1, Math.ceil(nextTotal / NOTIFICATIONS_PAGE_SIZE)),
      unreadCount: get().unreadCount + (n.read_at ? 0 : 1),
    })
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
