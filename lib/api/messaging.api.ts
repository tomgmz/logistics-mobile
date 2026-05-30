import api from './auth.api'
import type {
  ConversationWithDetails,
  MessageRow,
  GroupRaw,
  GroupMessageRaw,
} from '../../types/messaging.types'

interface ApiRes<T> { success: boolean; data: T }

async function get<T>(url: string, params?: Record<string, string | number | undefined>): Promise<T> {
  const { data } = await api.get<ApiRes<T>>(url, { params })
  return data.data
}

async function post<T>(url: string, payload?: unknown): Promise<T> {
  const { data } = await api.post<ApiRes<T>>(url, payload)
  return data.data
}

async function patch<T>(url: string, payload?: unknown): Promise<T> {
  const { data } = await api.patch<ApiRes<T>>(url, payload ?? {})
  return data.data
}

const B = '/messaging'

export const messagingApi = {
  // ── DM ─────────────────────────────────────────────────────────────────────
  getConversations: () =>
    get<ConversationWithDetails[]>(`${B}/conversations`),

  getMessages: (conversationId: string, params?: { limit?: number; before?: string }) =>
    get<MessageRow[]>(`${B}/conversations/${conversationId}/messages`, params),

  sendMessage: (conversationId: string, body: { content: string; reply_to_message_id?: string }) =>
    post<MessageRow>(`${B}/conversations/${conversationId}/messages`, body),

  markAsRead: (conversationId: string) =>
    patch<void>(`${B}/conversations/${conversationId}/read`),

  // ── Groups ──────────────────────────────────────────────────────────────────
  getGroups: () =>
    get<GroupRaw[]>(`${B}/groups`),

  respondToGroupInvite: (groupId: string, accept: boolean) =>
    patch<void>(`${B}/groups/${groupId}/invite/respond`, { accept }),

  getGroupMessages: (groupId: string, params?: { limit?: number; before?: string }) =>
    get<GroupMessageRaw[]>(`${B}/groups/${groupId}/messages`, params),

  sendGroupMessage: (groupId: string, body: { content: string; reply_to_message_id?: string }) =>
    post<GroupMessageRaw>(`${B}/groups/${groupId}/messages`, body),

  markGroupRead: (groupId: string, messageIds: string[] = []) =>
    patch<void>(`${B}/groups/${groupId}/read`, { message_ids: messageIds }),

  reactToMessage: (conversationId: string, messageId: string, emoji: string) =>
    post<{ action: 'added' | 'removed' }>(`${B}/conversations/${conversationId}/messages/${messageId}/react`, { emoji }),

  reactToGroupMessage: (groupId: string, messageId: string, emoji: string) =>
    post<{ action: 'added' | 'removed' }>(`${B}/groups/${groupId}/messages/${messageId}/react`, { emoji }),
}
