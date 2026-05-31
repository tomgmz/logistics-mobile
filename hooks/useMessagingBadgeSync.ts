import { useEffect, useRef } from 'react'
import { useMessagingRealtime } from './useMessagingRealtime'
import { useMessagingStore } from '../lib/store/messaging.store'

// Keeps the global unread badge in sync app-wide. Mounted in the driver layout so
// it stays subscribed across every screen (not just the messages list), which is
// what lets the header badge update without first opening the messaging module.
export function useMessagingBadgeSync(currentUserId: string) {
  const refresh = useMessagingStore(s => s.refresh)
  const timer   = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Debounce so a burst of events triggers a single recompute.
  const schedule = () => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => { refresh() }, 300)
  }

  useEffect(() => {
    if (currentUserId) refresh()
    return () => { if (timer.current) clearTimeout(timer.current) }
  }, [currentUserId, refresh])

  useMessagingRealtime({
    currentUserId,
    onNewMessage:   schedule,
    onGroupMessage: schedule,
    onGroupInvite:  schedule,
    onReadReceipt:  schedule,
  })
}
