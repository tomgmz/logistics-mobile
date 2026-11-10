import React, { useEffect, useRef } from 'react'
import { View, Text, TextInput, TouchableOpacity, Animated, StyleSheet, type TextInputProps } from 'react-native'
import { ArrowDown, CornerUpLeft, Image as ImageIcon, Send, Smile, X } from 'lucide-react-native'
import Reanimated, { useSharedValue, useAnimatedStyle, withSpring, runOnJS } from 'react-native-reanimated'
import { GestureDetector, Gesture } from 'react-native-gesture-handler'
import { FONTS } from '../../lib/config/fonts'
import ChatPhotoBubble from './ChatPhotoBubble'
import { BookingMentionCards, BookingMentionMenu, MentionText, type BookingMentionPicker } from './BookingMention'

/*
 * Chat messages per the Figma Messages design (docs/figma/messaging,
 * 2026-11-10), shared by the direct and group chats:
 *
 *                       You replied to [name]
 *                            ( quoted message )
 *            (            your message, teal pill )
 *                                  [time]  seen
 *   ( their message, grey pill )
 *   [time]
 *
 * Pill bubbles; the time (and "seen" on yours) only under the last bubble of
 * a run; a reaction chip on the bubble's lower corner. A direct chat shows no
 * avatar or name (hideIdentity); a group keeps the sender's avatar and name.
 * Behaviour unchanged: swipe to reply, long press for the react / remove sheet.
 */

const C = {
  bg:     '#000000',
  raised: '#1f1f1f',
  ring:   '#5a5a5a',
  teal:   '#063a37',
  field:  '#111212',
  cyan:   '#4df9ed',
  white:  '#ffffff',
  label:  'rgba(255,255,255,0.7)',
  muted:  'rgba(255,255,255,0.45)',
  quote:  'rgba(255,255,255,0.55)',
}

export const QUICK_EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '😡']

interface ReactionGroup { emoji: string; count: number; reacted: boolean }

function groupReactions(reactions: { emoji: string; user_id: string }[], userId: string): ReactionGroup[] {
  const map = new Map<string, { count: number; reacted: boolean }>()
  for (const r of reactions) {
    const cur = map.get(r.emoji) ?? { count: 0, reacted: false }
    map.set(r.emoji, { count: cur.count + 1, reacted: cur.reacted || r.user_id === userId })
  }
  return [...map.entries()].map(([emoji, v]) => ({ emoji, ...v }))
}

/** "You replied to Ali", "Ali replied to you", "You replied to yourself". */
function replyLabel(isMine: boolean, senderName: string, replyName?: string): string {
  const quoted = replyName ?? 'a message'
  if (isMine) return `You replied to ${quoted === 'You' ? 'yourself' : quoted}`
  const who = senderName.split(/\s+/)[0] || senderName
  return `${who} replied to ${quoted === 'You' ? 'you' : quoted}`
}

export function initialsOf(name: string): string {
  return name.split(/\s+/).map(w => w[0] ?? '').join('').slice(0, 2).toUpperCase() || '?'
}

export function MessageAvatar({ initials, online, icon }: { initials?: string; online?: boolean; icon?: React.ReactNode }) {
  return (
    <View style={s.avatar}>
      {icon ?? <Text style={s.avatarText}>{initials}</Text>}
      {online && <View style={s.onlineDot} />}
    </View>
  )
}

export function MessageDateDivider({ label }: { label: string }) {
  return (
    <View style={s.divider}>
      <View style={s.dividerLine} />
      <Text style={s.dividerText}>{label}</Text>
      <View style={s.dividerLine} />
    </View>
  )
}

/** The other side is typing: their label over a three-dot bubble. */
export function TypingMessage({ name, initials, icon }: { name?: string; initials?: string; icon?: React.ReactNode }) {
  const dots = useRef([new Animated.Value(0), new Animated.Value(0), new Animated.Value(0)]).current
  useEffect(() => {
    const loop = Animated.loop(Animated.stagger(150, dots.map(a =>
      Animated.sequence([
        Animated.timing(a, { toValue: -3, duration: 300, useNativeDriver: true }),
        Animated.timing(a, { toValue:  0, duration: 300, useNativeDriver: true }),
      ])
    )))
    loop.start()
    return () => loop.stop()
  }, [dots])
  return (
    <View style={[s.row, s.rowTheirs]}>
      <MessageAvatar initials={initials} icon={icon} />
      <View style={s.article}>
        <View style={[s.typingBubble]}>
          {dots.map((a, i) => (
            <Animated.View key={i} style={[s.typingDot, i === 1 && s.typingDotDim, { transform: [{ translateY: a }] }]} />
          ))}
        </View>
        {name ? <Text style={s.name} numberOfLines={1}>{name}</Text> : null}
      </View>
    </View>
  )
}

export interface MessageItemData {
  id:                  string
  content:             string
  sent_at:             string
  reply_to:            { message_id: string; content: string; sender_id: string } | null
  reactions:           { emoji: string; user_id: string }[]
  attachment_url?:     string | null
  attachment_stamped?: boolean
}

export function MessageItem({
  msg, isMine, currentUserId, senderName, showName, initials, online, time, seen,
  replyName, onLongPress, onReact, onReply, footer, hideIdentity = false,
}: {
  msg:           MessageItemData
  isMine:        boolean
  currentUserId: string
  senderName:    string
  /** True on the last message of a run from one sender: name (and their avatar). */
  showName:      boolean
  initials:      string
  online?:       boolean
  time:          string
  /** Your own messages only. */
  seen?:         boolean
  /** Who the quoted message is from. */
  replyName?:    string
  onLongPress:   (id: string) => void
  onReact:       (id: string, emoji: string) => void
  onReply:       () => void
  /** Under the message at the far right of the thread (a group's "seen by"). */
  footer?:       React.ReactNode
  /** A direct chat: no avatar or name beside the other person's bubbles. */
  hideIdentity?: boolean
}) {
  const translateX = useSharedValue(0)
  const triggered  = useSharedValue(false)
  const THRESHOLD  = 65
  const pending    = msg.id.startsWith('optimistic-')
  const grouped    = groupReactions(msg.reactions, currentUserId)
  const isPhoto    = !!msg.attachment_url

  // Swipe toward the middle to reply, as before.
  const panGesture = Gesture.Pan()
    .activeOffsetX(isMine ? [-10, 999] : [-999, 10])
    .failOffsetY([-8, 8])
    .onUpdate((e) => {
      if (isMine && e.translationX < 0) {
        translateX.value = Math.max(e.translationX, -THRESHOLD)
        if (translateX.value <= -THRESHOLD && !triggered.value) {
          triggered.value = true
          runOnJS(onReply)()
        }
      } else if (!isMine && e.translationX > 0) {
        translateX.value = Math.min(e.translationX, THRESHOLD)
        if (translateX.value >= THRESHOLD && !triggered.value) {
          triggered.value = true
          runOnJS(onReply)()
        }
      }
    })
    .onEnd(() => {
      triggered.value = false
      translateX.value = withSpring(0, { damping: 20, stiffness: 300 })
    })

  const slide    = useAnimatedStyle(() => ({ transform: [{ translateX: translateX.value }] }))
  const iconAnim = useAnimatedStyle(() => {
    const progress = Math.min(Math.abs(translateX.value) / THRESHOLD, 1)
    return { opacity: progress, transform: [{ scale: 0.6 + 0.4 * progress }] }
  })

  return (
    <GestureDetector gesture={panGesture}>
      <View>
      <View style={[s.swipeRow, isMine ? s.swipeRowMine : s.swipeRowTheirs]}>
        {isMine && (
          <Reanimated.View style={[s.swipeIcon, iconAnim]}>
            <CornerUpLeft size={16} color={C.quote} />
          </Reanimated.View>
        )}
        <Reanimated.View style={[s.row, isMine ? s.rowMine : s.rowTheirs, slide, pending && s.pending]}>
          {!isMine && !hideIdentity && (showName ? <MessageAvatar initials={initials} online={online} /> : <View style={s.avatarSpacer} />)}

          <View style={[s.article, isMine ? s.articleMine : s.articleTheirs]}>
            {/* "You replied to …" and the quoted message, tucked under the bubble. */}
            {msg.reply_to?.message_id ? (
              <>
                <Text style={[s.replyLabel, isMine ? s.alignEnd : s.alignStart]} numberOfLines={1}>
                  {replyLabel(isMine, senderName, replyName)}
                </Text>
                <View style={[s.replyQuote, isMine ? s.alignEnd : s.alignStart]}>
                  <Text style={s.replyQuoteText} numberOfLines={1}>{msg.reply_to.content}</Text>
                </View>
              </>
            ) : null}

            <TouchableOpacity
              onLongPress={() => onLongPress(msg.id)}
              onPress={() => {}}
              activeOpacity={0.85}
              delayLongPress={350}
              style={[
                s.bubble,
                isMine ? s.bubbleMine : s.bubbleTheirs,
                msg.reply_to?.message_id ? s.bubbleOverQuote : null,
                isPhoto && s.bubblePhoto,
              ]}
            >
              {isPhoto
                ? <ChatPhotoBubble url={msg.attachment_url!} stamped={msg.attachment_stamped} caption={msg.content}
                    textStyle={s.text} onLongPress={() => onLongPress(msg.id)} />
                : <MentionText text={msg.content} style={s.text} />}
            </TouchableOpacity>

            {/* Reaction chips on the bubble's lower corner (inner side). */}
            {grouped.length > 0 && (
              <View style={[s.reactions, isMine ? s.reactionsMine : s.reactionsTheirs]}>
                {grouped.map(r => (
                  <TouchableOpacity
                    key={r.emoji}
                    onPress={() => onReact(msg.id, r.emoji)}
                    activeOpacity={0.75}
                    style={[s.reaction, r.reacted && s.reactionOn]}
                  >
                    <Text style={s.reactionEmoji}>{r.emoji}</Text>
                    {r.count > 1 && <Text style={[s.reactionCount, r.reacted && s.reactionCountOn]}>{r.count}</Text>}
                  </TouchableOpacity>
                ))}
              </View>
            )}

            {/* A mentioned booking's important details, under the message. */}
            <BookingMentionCards text={msg.content} alignEnd={isMine} />

            {/* Last bubble of a run: (name ·) time, and "seen" on yours. */}
            {showName && (
              <View style={[s.meta, isMine ? s.metaMine : s.metaTheirs]}>
                {!hideIdentity && !isMine && <Text style={s.name} numberOfLines={1}>{senderName}</Text>}
                {!hideIdentity && !isMine && <Text style={s.dot}>·</Text>}
                <Text style={s.time}>{pending ? 'sending…' : time}</Text>
                {isMine && seen && !pending && <Text style={s.seen}>seen</Text>}
              </View>
            )}
          </View>
        </Reanimated.View>
        {!isMine && (
          <Reanimated.View style={[s.swipeIcon, iconAnim]}>
            <CornerUpLeft size={16} color={C.quote} />
          </Reanimated.View>
        )}
      </View>
      {/* Group "seen by": always the far right edge, whoever sent it. */}
      {footer ? <View style={s.footer}>{footer}</View> : null}
      </View>
    </GestureDetector>
  )
}

/**
 * Untitled UI's message composer: the field, with photo / emoji and Send along
 * its bottom edge, and the message being replied to quoted inside it.
 */
export function MessageComposer({
  inputRef, value, onChangeText, onFocus, onSend, sending, emojiOpen, onToggleEmoji, onPhoto,
  replyTo, onCancelReply, mention, showJumpToLatest = false, onJumpToLatest,
}: {
  inputRef:      React.RefObject<TextInput | null>
  value:         string
  onChangeText:  TextInputProps['onChangeText']
  onFocus?:      () => void
  onSend:        () => void
  sending:       boolean
  emojiOpen:     boolean
  onToggleEmoji: () => void
  onPhoto:       () => void
  replyTo?:      { name: string; content: string } | null
  onCancelReply: () => void
  /** "@" booking mentions (useBookingMentionPicker). */
  mention?:      BookingMentionPicker
  /** The newest message is out of view: the arrow-down above the box. */
  showJumpToLatest?: boolean
  onJumpToLatest?:   () => void
}) {
  const canSend = !!value.trim() && !sending
  return (
    <View style={s.composerBar}>
      {mention && <BookingMentionMenu picker={mention} />}
      {showJumpToLatest && onJumpToLatest && !mention?.open && (
        <View style={s.jumpWrap} pointerEvents="box-none">
          <TouchableOpacity onPress={onJumpToLatest} activeOpacity={0.8} style={s.jumpBtn}
            accessibilityRole="button" accessibilityLabel="Go to the latest message">
            <ArrowDown size={18} color="rgba(255,255,255,0.85)" />
          </TouchableOpacity>
        </View>
      )}
      <View style={s.composer}>
        {replyTo && (
          <View style={[s.quote, s.composerQuote]}>
            <View style={s.flex}>
              <Text style={s.quoteName} numberOfLines={1}>Replying to {replyTo.name}</Text>
              <Text style={s.quoteText} numberOfLines={1}>{replyTo.content}</Text>
            </View>
            <TouchableOpacity onPress={onCancelReply} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} accessibilityLabel="Cancel reply">
              <X size={14} color={C.muted} />
            </TouchableOpacity>
          </View>
        )}
        <View style={s.composerRow}>
          <TouchableOpacity onPress={onToggleEmoji} activeOpacity={0.7} style={[s.iconBtn, emojiOpen && s.iconBtnOn]}
            hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }} accessibilityLabel="Emoji">
            <Smile size={24} color={emojiOpen ? C.cyan : 'rgba(255,255,255,0.7)'} strokeWidth={1.6} />
          </TouchableOpacity>
          <TouchableOpacity onPress={onPhoto} activeOpacity={0.7} style={s.iconBtn}
            hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }} accessibilityLabel="Send a photo">
            <ImageIcon size={24} color="rgba(255,255,255,0.7)" strokeWidth={1.6} />
          </TouchableOpacity>
          <TextInput
            ref={inputRef}
            value={value}
            onChangeText={(v) => { mention?.onText(v); onChangeText?.(v) }}
            onSelectionChange={(e) => mention?.onSelection(e.nativeEvent.selection.end)}
            // Late, so a tap on the booking list still lands first.
            onBlur={() => setTimeout(() => mention?.close(), 150)}
            onFocus={onFocus}
            placeholder="Type your message"
            placeholderTextColor="rgba(255,255,255,0.4)"
            style={s.input}
            multiline
            maxLength={5000}
          />
          <TouchableOpacity
            onPress={onSend}
            disabled={!canSend}
            activeOpacity={0.75}
            style={[s.sendBtn, !canSend && s.sendBtnOff]}
            accessibilityLabel="Send"
          >
            <Send size={20} color={C.cyan} strokeWidth={1.8} />
          </TouchableOpacity>
        </View>
      </View>
    </View>
  )
}

// Darker Grotesque: the face in the Messages design (Figma, 2026-11-10).
const DG = FONTS.darker

const s = StyleSheet.create({
  flex: { flex: 1 },

  swipeRow:       { flexDirection: 'row', alignItems: 'center' },
  swipeRowMine:   { justifyContent: 'flex-end' },
  swipeRowTheirs: { justifyContent: 'flex-start' },
  swipeIcon:      { width: 28, height: 28, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },

  row:       { flexDirection: 'row', alignItems: 'flex-end', gap: 8, flexShrink: 1, maxWidth: '100%' },
  rowMine:   { paddingLeft: 40 },
  rowTheirs: { paddingRight: 40 },
  pending:   { opacity: 0.6 },

  avatar:       { width: 28, height: 28, borderRadius: 14, backgroundColor: C.field, borderWidth: 1, borderColor: C.ring, alignItems: 'center', justifyContent: 'center' },
  avatarText:   { color: C.white, fontFamily: DG.medium, fontSize: 13 },
  avatarSpacer: { width: 28 },
  onlineDot:    { position: 'absolute', right: -1, bottom: -1, width: 9, height: 9, borderRadius: 4.5, backgroundColor: '#3af626', borderWidth: 1.5, borderColor: C.bg },

  article:       { flexShrink: 1, gap: 4 },
  articleMine:   { alignItems: 'flex-end' },
  articleTheirs: { alignItems: 'flex-start' },
  alignEnd:      { alignSelf: 'flex-end' },
  alignStart:    { alignSelf: 'flex-start' },

  meta:       { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 2, marginBottom: 6 },
  metaMine:   { alignSelf: 'flex-end' },
  metaTheirs: { alignSelf: 'flex-start' },
  name:       { flexShrink: 1, color: C.label, fontFamily: DG.semiBold, fontSize: 13 },
  dot:        { color: 'rgba(255,255,255,0.3)', fontSize: 12 },
  time:       { color: C.muted, fontFamily: DG.medium, fontSize: 13 },
  seen:       { color: C.cyan, fontFamily: DG.semiBold, fontSize: 13 },
  footer:     { alignSelf: 'flex-end', marginTop: 2 },

  // Pill bubbles: yours teal with a cyan edge, theirs grey.
  bubble:          { borderRadius: 18, borderWidth: 1, paddingHorizontal: 13, paddingVertical: 7, minHeight: 35, justifyContent: 'center' },
  bubbleMine:      { backgroundColor: C.teal, borderColor: C.cyan },
  bubbleTheirs:    { backgroundColor: C.raised, borderColor: C.ring },
  bubbleOverQuote: { marginTop: -12 },
  bubblePhoto:     { padding: 6, borderRadius: 16 },
  text:            { color: C.white, fontFamily: DG.medium, fontSize: 17, lineHeight: 21 },

  // "You replied to …" + the quoted message, half under the bubble.
  replyLabel:     { color: C.muted, fontFamily: DG.medium, fontSize: 13, marginBottom: 2, maxWidth: 260 },
  replyQuote:     { backgroundColor: C.raised, borderWidth: 1, borderColor: C.ring, borderRadius: 18, paddingHorizontal: 13, paddingTop: 6, paddingBottom: 16, maxWidth: 220 },
  replyQuoteText: { color: 'rgba(255,255,255,0.85)', fontFamily: DG.medium, fontSize: 16 },

  // Reaction chips on the bubble's lower corner.
  reactions:       { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: -12, zIndex: 2 },
  reactionsMine:   { alignSelf: 'flex-start' },
  reactionsTheirs: { alignSelf: 'flex-end' },
  reaction:        { flexDirection: 'row', alignItems: 'center', gap: 3, height: 22, paddingHorizontal: 7, borderRadius: 11, backgroundColor: C.teal, borderWidth: 1, borderColor: C.cyan },
  reactionOn:      { backgroundColor: '#0a4d49' },
  reactionEmoji:   { fontSize: 12 },
  reactionCount:   { color: C.white, fontFamily: DG.semiBold, fontSize: 12 },
  reactionCountOn: { color: C.cyan },

  // Date: dashed rule, label in the middle.
  divider:     { flexDirection: 'row', alignItems: 'center', gap: 8, marginVertical: 10, paddingHorizontal: 4 },
  dividerLine: { flex: 1, height: 0, borderTopWidth: 1, borderStyle: 'dashed', borderColor: 'rgba(255,255,255,0.35)' },
  dividerText: { color: C.muted, fontFamily: DG.medium, fontSize: 14 },

  typingBubble: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, width: 48, height: 30, alignSelf: 'flex-start', borderRadius: 15, backgroundColor: C.raised, borderWidth: 1, borderColor: C.ring },
  typingDot:    { width: 5, height: 5, borderRadius: 2.5, backgroundColor: 'rgba(255,255,255,0.6)' },
  typingDotDim: { backgroundColor: 'rgba(255,255,255,0.35)' },

  // Input bar: emoji, photo, the pill field, round send.
  jumpWrap:      { position: 'absolute', left: 0, right: 0, bottom: '100%', marginBottom: 10, alignItems: 'center', zIndex: 30 },
  jumpBtn:       { width: 38, height: 38, borderRadius: 19, backgroundColor: '#222', borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center', elevation: 8, shadowColor: '#000', shadowOpacity: 0.4, shadowRadius: 8, shadowOffset: { width: 0, height: 3 } },
  composerBar:   { paddingHorizontal: 16, paddingTop: 13, paddingBottom: 12, backgroundColor: C.bg, borderTopWidth: 1, borderTopColor: '#2f2f2f' },
  composer:      {},
  composerRow:   { flexDirection: 'row', alignItems: 'center', gap: 8 },
  composerQuote: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: C.raised, borderWidth: 1, borderColor: C.ring, borderLeftWidth: 3, borderLeftColor: C.cyan, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 6, marginBottom: 8 },
  quote:         {},
  quoteName:     { color: C.cyan, fontFamily: DG.semiBold, fontSize: 13 },
  quoteText:     { color: C.quote, fontFamily: DG.medium, fontSize: 15, lineHeight: 18 },
  input:         { flex: 1, color: C.white, fontFamily: DG.medium, fontSize: 17, minHeight: 40, maxHeight: 120, borderRadius: 20, borderWidth: 1, borderColor: C.ring, backgroundColor: C.field, paddingHorizontal: 14, paddingTop: 8, paddingBottom: 8 },
  iconBtn:       { padding: 2, borderRadius: 8 },
  iconBtnOn:     { backgroundColor: 'rgba(77,249,237,0.1)' },
  sendBtn:       { width: 40, height: 40, borderRadius: 20, backgroundColor: C.teal, alignItems: 'center', justifyContent: 'center' },
  sendBtnOff:    { opacity: 0.5 },
})
