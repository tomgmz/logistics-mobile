import api from './auth.api'

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

export const notificationApi = {
  list: async (params?: { limit?: number; before?: string }): Promise<AppNotification[]> => {
    const { data } = await api.get('/notifications', { params })
    return data?.data ?? []
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
