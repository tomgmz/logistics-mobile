// ─── Shared ───────────────────────────────────────────────────────────────────

export interface MessageReaction { emoji: string; user_id: string }
export interface MessageReplyTo  { message_id: string; content: string; sender_id: string }

// ─── DM raw (mirrors backend API) ────────────────────────────────────────────

export interface ConversationWithDetails {
  conversation_id:  string
  participant_a_id: string
  participant_b_id: string
  context_type:     'direct' | 'booking_transit'
  booking_id:       string | null
  created_at:       string
  updated_at:       string
  last_message_at:  string | null
  other_user: {
    user_id:    string
    first_name: string | null
    last_name:  string | null
    role:       string
    email:      string
  }
  last_message: { message_id: string; content: string; sent_at: string; sender_id: string } | null
  unread_count: number
}

export interface MessageRow {
  message_id:           string
  conversation_id:      string
  sender_id:            string
  receiver_id:          string
  content:              string
  is_read:              boolean
  sent_at:              string
  read_at:              string | null
  deleted_by_sender:    boolean
  deleted_by_receiver:  boolean
  reply_to_message_id:  string | null
  reply_to:             MessageReplyTo | null
  reactions:            MessageReaction[]
}

// ─── Group raw (mirrors backend API) ─────────────────────────────────────────

export interface GroupMessageRaw {
  message_id:           string
  group_id:             string
  sender_id:            string
  content:              string
  sent_at:              string
  reply_to_message_id:  string | null
  reply_to:             MessageReplyTo | null
  reactions:            MessageReaction[]
}

export interface GroupMemberRaw {
  status:       'pending' | 'accepted' | 'declined'
  invited_by:   string
  last_read_at: string | null
  user: {
    user_id:    string
    first_name: string | null
    last_name:  string | null
    role:       string
    email:      string
  }
}

export interface GroupRaw {
  group_id:     string
  name:         string
  created_by:   string
  created_at:   string
  members:      GroupMemberRaw[]
  last_message: { message_id: string; content: string; sent_at: string; sender_id: string } | null
  unread_count: number
  my_status:    'pending' | 'accepted' | 'declined'
}

// ─── Realtime payloads ────────────────────────────────────────────────────────

export interface GroupInvitePayload      { group_id: string; group_name: string }
export interface ReadReceiptPayload      { conversation_id: string; read_at: string }
export interface GroupReadReceiptPayload { group_id: string; user_id: string; read_at: string }
export interface ReactionTogglePayload   {
  message_id: string
  user_id:    string
  emoji:      string
  action:     'added' | 'removed'
  group_id?:  string
}
