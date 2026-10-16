import { useEffect } from 'react'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { useMessagingStore } from '../lib/store/messaging.store'

interface PresenceState { user_id: string; online_at: string }

const TOPIC = 'messaging:presence:global'

export function useGlobalPresence(currentUserId: string) {
  const setOnlineUserIds = useMessagingStore(s => s.setOnlineUserIds)

  useEffect(() => {
    if (!currentUserId) return

    let cancelled = false
    let channel: RealtimeChannel | null = null

    void (async () => {
      // supabase.channel() hands back the EXISTING channel for a topic it still
      // holds, and removal is asynchronous. Leave the driver area and come
      // straight back (the vendor-setup "Stay signed in", change password) and
      // the new mount got the old, already-subscribed channel — adding presence
      // listeners to it throws, which is a crash in a release build. Wait for
      // any leftover to be gone first.
      for (const old of supabase.getChannels()) {
        if (old.topic === `realtime:${TOPIC}`) await supabase.removeChannel(old)
      }
      if (cancelled) return

      const ch = supabase.channel(TOPIC, {
        config: { presence: { key: currentUserId } },
      })
      channel = ch

      const sync = () => setOnlineUserIds(Object.keys(ch.presenceState<PresenceState>()))

      ch
        .on('presence', { event: 'sync' },  sync)
        .on('presence', { event: 'join' },  sync)
        .on('presence', { event: 'leave' }, sync)
        .subscribe(async (status) => {
          if (status === 'SUBSCRIBED') {
            await ch.track({ user_id: currentUserId, online_at: new Date().toISOString() })
          }
        })
    })()

    return () => {
      cancelled = true
      if (channel) {
        void channel.untrack()
        void supabase.removeChannel(channel)
      }
      setOnlineUserIds([])
    }
  }, [currentUserId, setOnlineUserIds])
}
