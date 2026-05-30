import { useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import type {
  MessageRow, GroupMessageRaw, GroupInvitePayload,
  ReadReceiptPayload, GroupReadReceiptPayload, ReactionTogglePayload,
} from '../types/messaging.types'

interface PresenceState { user_id: string; online_at: string }

export interface UseMessagingRealtimeOptions {
  currentUserId:       string
  conversationId?:     string
  onNewMessage?:       (msg:     MessageRow)               => void
  onReadReceipt?:      (payload: ReadReceiptPayload)       => void
  onReactionToggle?:   (payload: ReactionTogglePayload)    => void
  onGroupMessage?:     (msg:     GroupMessageRaw)          => void
  onGroupReadReceipt?: (payload: GroupReadReceiptPayload)  => void
  onGroupInvite?:      (payload: GroupInvitePayload)       => void
  onPresenceChange?:   (onlineUserIds: string[])           => void
  onTyping?:           (userId: string, isTyping: boolean) => void
}

export function useMessagingRealtime(opts: UseMessagingRealtimeOptions) {
  const optsRef = useRef(opts)
  useEffect(() => { optsRef.current = opts })

  const { currentUserId, conversationId } = opts

  useEffect(() => {
    if (!currentUserId) return

    const isGroup     = conversationId?.startsWith('group:') ?? false
    const channelName = isGroup
      ? `messaging:group:${conversationId!.replace('group:', '')}`
      : conversationId
        ? `messaging:conv:${conversationId}`
        : `messaging:user:${currentUserId}`

    const channel = supabase.channel(channelName, {
      config: { presence: { key: currentUserId } },
    })

    channel
      .on('broadcast', { event: 'new_message' }, ({ payload }) => {
        if (!isGroup && conversationId && payload.conversation_id !== conversationId) return
        optsRef.current.onNewMessage?.(payload as MessageRow)
      })
      .on('broadcast', { event: 'read_receipt' }, ({ payload }) => {
        optsRef.current.onReadReceipt?.(payload as ReadReceiptPayload)
      })
      .on('broadcast', { event: 'new_group_message' }, ({ payload }) => {
        optsRef.current.onGroupMessage?.(payload as GroupMessageRaw)
      })
      .on('broadcast', { event: 'reaction_toggle' }, ({ payload }) => {
        const p = payload as ReactionTogglePayload
        if (p.user_id === currentUserId) return
        optsRef.current.onReactionToggle?.(p)
      })
      .on('broadcast', { event: 'group_read_receipt' }, ({ payload }) => {
        const p = payload as GroupReadReceiptPayload
        if (p.user_id === currentUserId) return
        optsRef.current.onGroupReadReceipt?.(p)
      })
      .on('broadcast', { event: 'group_invite' }, ({ payload }) => {
        optsRef.current.onGroupInvite?.(payload as GroupInvitePayload)
      })
      .on('broadcast', { event: 'typing' }, ({ payload }) => {
        const p = payload as { user_id: string; is_typing: boolean }
        if (p.user_id === currentUserId) return
        optsRef.current.onTyping?.(p.user_id, p.is_typing)
      })

    channel
      .on('presence', { event: 'sync' }, () => {
        optsRef.current.onPresenceChange?.(
          Object.keys(channel.presenceState<PresenceState>())
        )
      })
      .on('presence', { event: 'join' }, () => {
        optsRef.current.onPresenceChange?.(
          Object.keys(channel.presenceState<PresenceState>())
        )
      })
      .on('presence', { event: 'leave' }, () => {
        optsRef.current.onPresenceChange?.(
          Object.keys(channel.presenceState<PresenceState>())
        )
      })

    channel.subscribe(async (status) => {
      if (status === 'SUBSCRIBED') {
        await channel.track({ user_id: currentUserId, online_at: new Date().toISOString() })
      }
    })

    return () => {
      channel.untrack()
      supabase.removeChannel(channel)
    }
  }, [currentUserId, conversationId])
}
