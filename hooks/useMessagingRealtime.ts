import { useEffect, useRef, useCallback } from 'react'
import type { MutableRefObject } from 'react'
import type { RealtimeChannel } from '@supabase/supabase-js'
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

type OptsRef = MutableRefObject<UseMessagingRealtimeOptions>

interface ChannelEntry {
  channel:     RealtimeChannel
  subscribers: Set<OptsRef>
}

const registry = new Map<string, ChannelEntry>()

function createEntry(
  channelName:    string,
  currentUserId:  string,
  conversationId: string | undefined,
  isGroup:        boolean,
): ChannelEntry {
  const realtimeTopic = `realtime:${channelName}`
  supabase
    .getChannels()
    .filter((c) => c.topic === realtimeTopic)
    .forEach((c) => supabase.removeChannel(c))

  const subscribers = new Set<OptsRef>()
  const emit = (fn: (o: UseMessagingRealtimeOptions) => void) =>
    subscribers.forEach((ref) => fn(ref.current))

  const channel = supabase.channel(channelName, {
    config: { presence: { key: currentUserId } },
  })

  channel
    .on('broadcast', { event: 'new_message' }, ({ payload }) => {
      if (!isGroup && conversationId && payload.conversation_id !== conversationId) return
      emit((o) => o.onNewMessage?.(payload as MessageRow))
    })
    .on('broadcast', { event: 'read_receipt' }, ({ payload }) => {
      emit((o) => o.onReadReceipt?.(payload as ReadReceiptPayload))
    })
    .on('broadcast', { event: 'new_group_message' }, ({ payload }) => {
      emit((o) => o.onGroupMessage?.(payload as GroupMessageRaw))
    })
    .on('broadcast', { event: 'reaction_toggle' }, ({ payload }) => {
      const p = payload as ReactionTogglePayload
      if (p.user_id === currentUserId) return
      emit((o) => o.onReactionToggle?.(p))
    })
    .on('broadcast', { event: 'group_read_receipt' }, ({ payload }) => {
      const p = payload as GroupReadReceiptPayload
      if (p.user_id === currentUserId) return
      emit((o) => o.onGroupReadReceipt?.(p))
    })
    .on('broadcast', { event: 'group_invite' }, ({ payload }) => {
      emit((o) => o.onGroupInvite?.(payload as GroupInvitePayload))
    })
    .on('broadcast', { event: 'typing' }, ({ payload }) => {
      const p = payload as { user_id: string; is_typing: boolean }
      if (p.user_id === currentUserId) return
      emit((o) => o.onTyping?.(p.user_id, p.is_typing))
    })

  const emitPresence = () =>
    emit((o) => o.onPresenceChange?.(Object.keys(channel.presenceState<PresenceState>())))

  channel
    .on('presence', { event: 'sync' },  emitPresence)
    .on('presence', { event: 'join' },  emitPresence)
    .on('presence', { event: 'leave' }, emitPresence)

  channel.subscribe(async (status) => {
    if (status === 'SUBSCRIBED') {
      await channel.track({ user_id: currentUserId, online_at: new Date().toISOString() })
    }
  })

  return { channel, subscribers }
}

export function useMessagingRealtime(opts: UseMessagingRealtimeOptions) {
  const optsRef = useRef(opts)
  useEffect(() => { optsRef.current = opts })

  const { currentUserId, conversationId } = opts

  const channelNameRef = useRef<string | null>(null)

  useEffect(() => {
    if (!currentUserId) return

    const isGroup     = conversationId?.startsWith('group:') ?? false
    const channelName = isGroup
      ? `messaging:group:${conversationId!.replace('group:', '')}`
      : conversationId
        ? `messaging:conv:${conversationId}`
        : `messaging:user:${currentUserId}`

    channelNameRef.current = channelName

    let entry = registry.get(channelName)
    if (!entry) {
      entry = createEntry(channelName, currentUserId, conversationId, isGroup)
      registry.set(channelName, entry)
    }
    entry.subscribers.add(optsRef)

    return () => {
      const e = registry.get(channelName)
      if (!e) return
      e.subscribers.delete(optsRef)
      if (e.subscribers.size === 0) {
        registry.delete(channelName)
        e.channel.untrack()
        supabase.removeChannel(e.channel)
      }
    }
  }, [currentUserId, conversationId])

  const broadcastTyping = useCallback((isTyping: boolean) => {
    const name = channelNameRef.current
    if (!name) return
    registry.get(name)?.channel.send({
      type: 'broadcast',
      event: 'typing',
      payload: { user_id: currentUserId, is_typing: isTyping },
    })
  }, [currentUserId])

  return { broadcastTyping }
}
