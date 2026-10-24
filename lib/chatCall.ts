import { create } from 'zustand'

import api from './api/auth.api'

/**
 * Voice calls from Messages (LiveKit), one person to one person. Never with a
 * client: the server refuses those, and the call button is hidden for them.
 *
 * The audio side (the native LiveKit modules, the microphone) is shared with the
 * emergency call in lib/voiceCall.ts. The call itself runs in ChatCallHost,
 * which is mounted once in the driver layout so a call can ring on any screen.
 */

export interface ChatCallView {
  call_id:         string
  conversation_id: string
  caller_id:       string
  caller_name:     string
  caller_role:     string
  callee_id:       string
  callee_name:     string
  callee_role:     string
  status:          'ringing' | 'answered' | 'ended' | 'missed' | 'declined'
  created_at:      string
}

export interface JoinedCall {
  call:  ChatCallView
  url:   string
  token: string
}

export async function startChatCall(conversationId: string): Promise<JoinedCall & { ring_seconds: number }> {
  const { data } = await api.post('/messaging/calls', { conversation_id: conversationId }, { timeout: 10_000 })
  return data.data
}

/** Calls ringing for me right now — for an app that just came to the front. */
export async function ringingChatCalls(): Promise<ChatCallView[]> {
  const { data } = await api.get('/messaging/calls/ringing', { timeout: 8_000 })
  return data.data ?? []
}

export async function answerChatCall(callId: string): Promise<JoinedCall> {
  const { data } = await api.post(`/messaging/calls/${callId}/answer`, undefined, { timeout: 10_000 })
  return data.data
}

/** Best effort: the caller's ring timer ends the call anyway. */
export async function declineChatCall(callId: string): Promise<void> {
  try { await api.post(`/messaging/calls/${callId}/decline`, undefined, { timeout: 8_000 }) } catch {}
}

/** Best effort: tells the other end the call is over. */
export async function endChatCall(
  callId: string,
  reason: 'hangup' | 'no_answer' | 'failed' = 'hangup',
  detail?: string,
): Promise<void> {
  try {
    await api.post(
      `/messaging/calls/${callId}/end`,
      { reason, ...(detail ? { detail: detail.slice(0, 500) } : {}) },
      { timeout: 8_000 },
    )
  } catch {}
}

/* ── Button → host ────────────────────────────────────────────────────────── */

export interface CallRequest {
  conversationId: string
  /** Shown while the call is being placed, before the server answers. */
  peerName:       string
  peerRole:       string
}

/**
 * The link between a chat header's call button and ChatCallHost. The host
 * registers `placeCall` while it is mounted.
 */
interface ChatCallStore {
  placeCall:    ((req: CallRequest) => void) | null
  /** True while the phone is ringing out, ringing in, or on a call. */
  inCall:       boolean
  /** The conversation that call is with, so its own button doesn't call again. */
  callConversationId: string | null
  setPlaceCall: (fn: ((req: CallRequest) => void) | null) => void
  setInCall:    (v: boolean, conversationId?: string | null) => void
}

export const useChatCallStore = create<ChatCallStore>((set) => ({
  placeCall:    null,
  inCall:       false,
  callConversationId: null,
  setPlaceCall: (placeCall) => set({ placeCall }),
  setInCall:    (inCall, conversationId = null) => set({ inCall, callConversationId: inCall ? conversationId : null }),
}))
