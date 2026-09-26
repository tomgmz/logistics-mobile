import api from './auth.api'
import { expandText } from '../roles'

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

  unreadCount: async (): Promise<number> => {
    const { data } = await api.get('/notifications/unread-count')
    return data?.data?.count ?? 0
  },

  markRead: async (id: string): Promise<void> => {
    await api.patch(`/notifications/${id}/read`)
  },

  markAllRead: async (): Promise<void> => {
    await api.patch('/notifications/read-all')
  },
}
