import api from './auth.api'
import { expandText } from '../roles'
import { cachedFetch } from '../query/useApiQuery'

export interface AppNotification {
  notification_id: string
  user_id:         string
  type:            string
  title:           string
  body:            string
  booking_id:      string | null
  data:            Record<string, unknown>
  read_at:         string | null
  created_at:      string
}

// Spell out abbreviations in text stored before the UI stopped using them.
export const normalizeNotification = (n: AppNotification): AppNotification => ({
  ...n,
  title: expandText(n.title),
  body:  expandText(n.body),
})

export const notificationApi = {
  list: async (params?: { limit?: number; before?: string }): Promise<AppNotification[]> => {
    const { data } = await api.get('/notifications', { params })
    return ((data?.data ?? []) as AppNotification[]).map(normalizeNotification)
  },

  /** One numbered page, newest first, with the total for the pager. */
  page: async (page: number, limit: number): Promise<{ items: AppNotification[]; total: number; totalPages: number }> => {
    const data = await cachedFetch(['notifications', page, limit], async () => (await api.get('/notifications', { params: { page, limit } })).data)
    return {
      items:      ((data?.data ?? []) as AppNotification[]).map(normalizeNotification),
      total:      data?.meta?.total ?? 0,
      totalPages: data?.meta?.totalPages ?? 1,
    }
  },

  unreadCount: async (): Promise<number> => {
    const data = await cachedFetch(['notifications', 'unread-count'], async () => (await api.get('/notifications/unread-count')).data)
    return data?.data?.count ?? 0
  },

  markRead: async (id: string): Promise<void> => {
    await api.patch(`/notifications/${id}/read`)
  },

  markAllRead: async (): Promise<void> => {
    await api.patch('/notifications/read-all')
  },
}
