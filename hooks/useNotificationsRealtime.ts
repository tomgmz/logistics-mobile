import { useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useNotificationStore } from '../lib/store/notification.store'
import type { AppNotification } from '../lib/api/notification.api'

/**
 * Subscribes the signed-in user to their personal notification channel and keeps
 * the notification store in sync. Mount once in the driver layout.
 */
export function useNotificationsRealtime(currentUserId: string): void {
  const hydrate = useNotificationStore((s) => s.hydrate)
  const pushNew = useNotificationStore((s) => s.pushNew)

  useEffect(() => {
    if (!currentUserId) return

    hydrate()

    const channelName = `notifications:user:${currentUserId}`
    const realtimeTopic = `realtime:${channelName}`
    supabase
      .getChannels()
      .filter((c) => c.topic === realtimeTopic)
      .forEach((c) => supabase.removeChannel(c))

    const channel = supabase
      .channel(channelName)
      .on('broadcast', { event: 'new_notification' }, ({ payload }) => {
        const row = payload as AppNotification
        if (row?.notification_id) pushNew(row)
      })
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [currentUserId, hydrate, pushNew])
}
