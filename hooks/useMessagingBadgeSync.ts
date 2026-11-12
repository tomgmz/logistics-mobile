import { useEffect, useRef } from 'react'
import { useMessagingRealtime } from './useMessagingRealtime'
import { useMessagingStore } from '../lib/store/messaging.store'
import { useCatchUp } from './useLiveSignal'

export function useMessagingBadgeSync(currentUserId: string) {
  const refresh = useMessagingStore(s => s.refresh)
  const timer   = useRef<ReturnType<typeof setTimeout> | null>(null)

  const schedule = () => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => { refresh() }, 300)
  }

  useEffect(() => {
    if (currentUserId) refresh()
    return () => { if (timer.current) clearTimeout(timer.current) }
  }, [currentUserId, refresh])

  // Back from the background or offline: messages sent meanwhile never arrived live.
  useCatchUp(() => { if (currentUserId) refresh() }, { enabled: !!currentUserId })

  useMessagingRealtime({
    currentUserId,
    onNewMessage:   schedule,
    onGroupMessage: schedule,
    onGroupInvite:  schedule,
    onReadReceipt:  schedule,
  })
}
