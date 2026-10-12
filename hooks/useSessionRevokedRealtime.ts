import { useEffect } from 'react'
import { supabase } from '../lib/supabase'
import api from '../lib/api/auth.api'

/**
 * Sign the driver out the moment their session is revoked elsewhere (signed in
 * on another device, access revoked), not on their next request.
 *
 * The backend broadcasts on `session:user:{userId}` whenever it revokes the
 * user's sessions. The event decides nothing by itself: the app asks the
 * server whether its own session still stands. A revoked one gets a 401, the
 * refresh is refused, and the API client's session-expired handler signs out.
 * The device that just signed in hears it too, passes the check and stays.
 */
export function useSessionRevokedRealtime(currentUserId: string): void {
  useEffect(() => {
    if (!currentUserId) return

    const channelName   = `session:user:${currentUserId}`
    const realtimeTopic = `realtime:${channelName}`
    supabase
      .getChannels()
      .filter((c) => c.topic === realtimeTopic)
      .forEach((c) => supabase.removeChannel(c))

    const channel = supabase
      .channel(channelName)
      .on('broadcast', { event: 'session_revoked' }, () => {
        void api.get('/notifications/unread-count').catch(() => {})
      })
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [currentUserId])
}
