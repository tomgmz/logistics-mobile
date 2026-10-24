export interface MessageReaction { emoji: string; user_id: string }
export interface MessageReplyTo  { message_id: string; content: string; sender_id: string }

export interface MessagableUser {
  user_id:    string
  first_name: string | null
  last_name:  string | null
  role:       string
  email:      string
  booking_id?: string
}

export interface ConversationWithDetails {
  conversation_id:             string
  participant_a_id:            string
  participant_b_id:            string
  context_type:                'direct' | 'booking_transit'
  booking_id:                  string | null
  created_at:                  string
  updated_at:                  string
  last_message_at:             string | null
  participant_a_last_read_at:  string | null
  participant_b_last_read_at:  string | null
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
  sent_at:              string
  deleted_by_sender:    boolean
  deleted_by_receiver:  boolean
  reply_to_message_id:  string | null
  reply_to:             MessageReplyTo | null
  reactions:            MessageReaction[]
  message_type?:        'text' | 'image' | 'system'
  /** A photo message's picture; `content` is then its caption (or "📷 Photo"). */
  attachment_url?:      string | null
  attachment_stamped?:  boolean
}


export interface GroupMessageRaw {
  message_id:           string
  group_id:             string
  sender_id:            string
  content:              string
  sent_at:              string
  reply_to_message_id:  string | null
  reply_to:             MessageReplyTo | null
  reactions:            MessageReaction[]
  /** 'system' = a group event (renamed, people added or removed), not a message. */
  message_type?:        'text' | 'image' | 'system'
  meta?:                GroupSystemEvent | null
  attachment_url?:      string | null
  attachment_stamped?:  boolean
}

/** A group event, shown as a centered line in the chat rather than a bubble. */
export type GroupSystemEvent =
  | { event: 'renamed'; name: string; previous_name?: string | null }
  | { event: 'added'; user_ids: string[]; names: string[] }
  | { event: 'removed'; user_id: string; name: string }

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

export interface GroupInvitePayload      { group_id: string; group_name: string }
/** A group was renamed, gained or lost members, or got a member request. */
export interface GroupUpdatedPayload     { group_id: string; name?: string }
/** A message was unsent for everyone. */
export interface MessageUnsentPayload    { message_id: string; conversation_id?: string; group_id?: string }

/** A member's request to add or remove someone, waiting on the group's creator. */
export interface GroupMemberRequest {
  request_id:   string
  action:       'add' | 'remove'
  requested_by: { user_id: string; name: string }
  target:       { user_id: string; name: string }
  created_at:   string
}
export interface ReadReceiptPayload      { conversation_id: string; reader_id: string; last_read_at: string }
export interface GroupReadReceiptPayload { group_id: string; user_id: string; read_at: string }
export interface ReactionTogglePayload   {
  message_id: string
  user_id:    string
  emoji:      string
  action:     'added' | 'removed'
  group_id?:  string
}

/** A booking offered in the "@" mention list. */
export interface MentionableBooking {
  booking_id:       string
  reference_number: string
  status:           string
  company_name:     string | null
  schedule_date:    string | null
}

/** The details card shown under a message that mentions a booking. */
export interface BookingMentionDetails extends MentionableBooking {
  call_time: string | null
  origin:    string | null
  drop_offs: string[]
  vehicle:   string | null
  drivers:   string[]
  /** A driver's short card for a booking they aren't on: number, status, schedule only. */
  limited?:  boolean
}
