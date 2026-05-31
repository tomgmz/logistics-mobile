import { useEffect, useRef } from 'react'
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

// Supabase dedupes realtime channels by topic, so two components listening on
// the same topic (e.g. the always-mounted badge sync and the messages list,
// both on `messaging:user:<id>`) can't each call `supabase.channel().on()` —
// the second `.on()` after `subscribe()` throws. We instead keep one shared
// channel per topic, fan every broadcast out to all registered subscribers, and
// tear the channel down only once the last subscriber unmounts. This keeps the
// header badge live across the whole driver area while still letting the
// messages screen react to the same events.
const registry = new Map<string, ChannelEntry>()

function createEntry(
  channelName:    string,
  currentUserId:  string,
  conversationId: string | undefined,
  isGroup:        boolean,
): ChannelEntry {
  // Drop any orphaned channel left behind by a previous mount/Fast Refresh —
  // `removeChannel` is async, so a fast remount can otherwise hand back a stale,
  // already-subscribed channel and adding `.on()` to it would throw.
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

  useEffect(() => {
    if (!currentUserId) return

    const isGroup     = conversationId?.startsWith('group:') ?? false
    const channelName = isGroup
      ? `messaging:group:${conversationId!.replace('group:', '')}`
      : conversationId
        ? `messaging:conv:${conversationId}`
        : `messaging:user:${currentUserId}`

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
      // Last subscriber gone — actually tear the channel down.
      if (e.subscribers.size === 0) {
        registry.delete(channelName)
        e.channel.untrack()
        supabase.removeChannel(e.channel)
      }
    }
  }, [currentUserId, conversationId])
}
