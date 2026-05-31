import { create } from 'zustand'
import { messagingApi } from '../api/messaging.api'

interface MessagingStore {
  totalUnread:     number
  setTotalUnread:  (n: number) => void
  incrementUnread: () => void
  decrementUnread: (by: number) => void
  // Recompute the badge from the server: unread messages + pending group invites.
  // Absolute (not a delta), so it is safe to call from anywhere without drift.
  refresh:         () => Promise<void>
}

export const useMessagingStore = create<MessagingStore>((set) => ({
  totalUnread:     0,
  setTotalUnread:  (totalUnread) => set({ totalUnread }),
  incrementUnread: () => set(s => ({ totalUnread: s.totalUnread + 1 })),
  decrementUnread: (by) => set(s => ({ totalUnread: Math.max(0, s.totalUnread - by) })),
  refresh: async () => {
    try {
      const [convs, groups] = await Promise.all([
        messagingApi.getConversations(),
        messagingApi.getGroups(),
      ])
      const pendingInvites = groups.filter(g => g.my_status === 'pending').length
      set({
        totalUnread:
          convs.reduce((s, c) => s + c.unread_count, 0) +
          groups.reduce((s, g) => s + g.unread_count, 0) +
          pendingInvites,
      })
    } catch { /* keep last known value */ }
  },
}))
