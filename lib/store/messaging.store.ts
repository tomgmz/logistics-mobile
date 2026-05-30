import { create } from 'zustand'

interface MessagingStore {
  totalUnread:     number
  setTotalUnread:  (n: number) => void
  incrementUnread: () => void
  decrementUnread: (by: number) => void
}

export const useMessagingStore = create<MessagingStore>((set) => ({
  totalUnread:     0,
  setTotalUnread:  (totalUnread) => set({ totalUnread }),
  incrementUnread: () => set(s => ({ totalUnread: s.totalUnread + 1 })),
  decrementUnread: (by) => set(s => ({ totalUnread: Math.max(0, s.totalUnread - by) })),
}))
