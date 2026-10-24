import api from './auth.api'
import type {
  ConversationWithDetails,
  MessageRow,
  GroupRaw,
  GroupMessageRaw,
  MessagableUser,
  GroupMemberRequest,
  MentionableBooking,
  BookingMentionDetails,
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

async function del<T>(url: string): Promise<T> {
  const { data } = await api.delete<ApiRes<T>>(url)
  return data.data
}

const B = '/messaging'

export const messagingApi = {
  getMessagableUsers: () =>
    get<MessagableUser[]>(`${B}/users`),

  /** Bookings offered after typing "@" (only those the driver is crewed on). */
  searchMentionableBookings: (q: string) =>
    get<MentionableBooking[]>(`${B}/booking-mentions`, { q }),

  /** Details cards for mentioned booking numbers; ones the driver can't see are left out. */
  getBookingMentionDetails: (refs: string[]) =>
    get<BookingMentionDetails[]>(`${B}/booking-mentions/details`, { refs: refs.join(',') }),

  createOrGetConversation: (body: { target_user_id: string; booking_id?: string }) =>
    post<{ conversation_id: string }>(`${B}/conversations`, body),

  resolveConversation: (target_user_id: string) =>
    get<{ conversation_id: string | null }>(`${B}/conversations/resolve`, { target_user_id }),

  sendDirectMessage: (body: { target_user_id: string; content: string; attachment_url?: string; reply_to_message_id?: string; booking_id?: string }) =>
    post<MessageRow>(`${B}/conversations/direct`, body),

  createGroup: (body: { name: string; member_ids: string[] }) =>
    post<{ group_id: string }>(`${B}/groups`, body),

  getConversations: () =>
    get<ConversationWithDetails[]>(`${B}/conversations`),

  getMessages: (conversationId: string, params?: { limit?: number; before?: string }) =>
    get<MessageRow[]>(`${B}/conversations/${conversationId}/messages`, params),

  sendMessage: (conversationId: string, body: { content: string; attachment_url?: string; reply_to_message_id?: string }) =>
    post<MessageRow>(`${B}/conversations/${conversationId}/messages`, body),

  markAsRead: (conversationId: string) =>
    patch<void>(`${B}/conversations/${conversationId}/read`),

  // 'me' deletes it for the caller; 'everyone' unsends it (sender only).
  deleteMessage: (messageId: string, scope: 'me' | 'everyone' = 'me') =>
    del<void>(`${B}/messages/${messageId}${scope === 'everyone' ? '?scope=everyone' : ''}`),

  getGroups: () =>
    get<GroupRaw[]>(`${B}/groups`),

  respondToGroupInvite: (groupId: string, accept: boolean) =>
    patch<void>(`${B}/groups/${groupId}/invite/respond`, { accept }),

  getGroupMessages: (groupId: string, params?: { limit?: number; before?: string }) =>
    get<GroupMessageRaw[]>(`${B}/groups/${groupId}/messages`, params),

  sendGroupMessage: (groupId: string, body: { content: string; attachment_url?: string; reply_to_message_id?: string }) =>
    post<GroupMessageRaw>(`${B}/groups/${groupId}/messages`, body),

  markGroupRead: (groupId: string) =>
    patch<void>(`${B}/groups/${groupId}/read`),

  // Only the group's creator renames it.
  renameGroup: (groupId: string, name: string) =>
    patch<{ name: string }>(`${B}/groups/${groupId}`, { name }),

  // The creator adds directly; anyone else's choice becomes a request for the creator.
  addGroupMembers: (groupId: string, memberIds: string[]) =>
    post<{ added: number; requested: number }>(`${B}/groups/${groupId}/members`, { member_ids: memberIds }),

  // Same rule for removing someone.
  removeGroupMember: (groupId: string, userId: string) =>
    del<{ removed: boolean; requested: boolean }>(`${B}/groups/${groupId}/members/${userId}`),

  // The creator's queue of add/remove requests.
  getGroupMemberRequests: (groupId: string) =>
    get<GroupMemberRequest[]>(`${B}/groups/${groupId}/requests`),

  decideGroupMemberRequest: (groupId: string, requestId: string, approve: boolean) =>
    post<void>(`${B}/groups/${groupId}/requests/${requestId}/decide`, { approve }),

  // Delete for me: hides a group message from the caller only.
  hideGroupMessage: (groupId: string, messageId: string, scope: 'me' | 'everyone' = 'me') =>
    del<void>(`${B}/groups/${groupId}/messages/${messageId}${scope === 'everyone' ? '?scope=everyone' : ''}`),

  reactToMessage: (conversationId: string, messageId: string, emoji: string) =>
    post<{ action: 'added' | 'removed' }>(`${B}/conversations/${conversationId}/messages/${messageId}/react`, { emoji }),

  reactToGroupMessage: (groupId: string, messageId: string, emoji: string) =>
    post<{ action: 'added' | 'removed' }>(`${B}/groups/${groupId}/messages/${messageId}/react`, { emoji }),
}
