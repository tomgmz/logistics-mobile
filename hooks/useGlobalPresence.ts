import { useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useMessagingStore } from '../lib/store/messaging.store'

interface PresenceState { user_id: string; online_at: string }

export function useGlobalPresence(currentUserId: string) {
  const setOnlineUserIds = useMessagingStore(s => s.setOnlineUserIds)

  useEffect(() => {
    if (!currentUserId) return

    const channel = supabase.channel('messaging:presence:global', {
      config: { presence: { key: currentUserId } },
    })

    const sync = () => setOnlineUserIds(Object.keys(channel.presenceState<PresenceState>()))

    channel
      .on('presence', { event: 'sync' },  sync)
      .on('presence', { event: 'join' },  sync)
      .on('presence', { event: 'leave' }, sync)
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          await channel.track({ user_id: currentUserId, online_at: new Date().toISOString() })
        }
      })

    return () => {
      channel.untrack()
      supabase.removeChannel(channel)
      setOnlineUserIds([])
    }
  }, [currentUserId, setOnlineUserIds])
}
