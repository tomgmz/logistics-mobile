import React, { useEffect, useRef } from 'react'
import { View, Text, TextInput, TouchableOpacity, Animated, StyleSheet, type TextInputProps } from 'react-native'
import { ArrowDown, CornerUpLeft, ImagePlus, Send, Smile, X } from 'lucide-react-native'
import Reanimated, { useSharedValue, useAnimatedStyle, withSpring, runOnJS } from 'react-native-reanimated'
import { GestureDetector, Gesture } from 'react-native-gesture-handler'
import { FONTS } from '../../lib/config/fonts'
import ChatPhotoBubble from './ChatPhotoBubble'
import ReadTicks from './ReadTicks'
import { BookingMentionCards, BookingMentionMenu, MentionText, type BookingMentionPicker } from './BookingMention'

/*
 * Chat messages after Untitled UI's message item
 * (untitledui.com/react/components/messaging), in our palette. Same layout as
 * the web:
 *
 *             ┌ bubble ────────────────────────────────┐
 *             │ ▌ quoted reply                         │
 *             │ text / photo                           │
 *   (avatar)  └ squared bottom corner, sender's side ──┘
 *             (👍 2) (❤️)
 *             Name · 10:41 AM ✓   (bottom left for others, bottom right for you)
 *
 * Only what Messages already does: swipe to reply, long press for the
 * react / remove sheet, reactions, sent / seen.
 */

const C = {
  bg:     '#0a0a0a',
  raised: 'rgba(255,255,255,0.06)',
  ring:   'rgba(255,255,255,0.08)',
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
  replyName, onLongPress, onReact, onReply, footer,
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
          {!isMine && (showName ? <MessageAvatar initials={initials} online={online} /> : <View style={s.avatarSpacer} />)}

          <View style={s.article}>
            <TouchableOpacity
              onLongPress={() => onLongPress(msg.id)}
              onPress={() => {}}
              activeOpacity={0.85}
              delayLongPress={350}
              style={[s.bubble, isMine ? s.bubbleMine : s.bubbleTheirs, isPhoto && !msg.reply_to && s.bubblePhoto]}
            >
              {msg.reply_to?.message_id ? (
                <View style={s.quote}>
                  {replyName ? <Text style={s.quoteName} numberOfLines={1}>{replyName}</Text> : null}
                  <Text style={s.quoteText} numberOfLines={2}>{msg.reply_to.content}</Text>
                </View>
              ) : null}
              {isPhoto
                ? <ChatPhotoBubble url={msg.attachment_url!} stamped={msg.attachment_stamped} caption={msg.content}
                    textStyle={s.text} onLongPress={() => onLongPress(msg.id)} />
                : <MentionText text={msg.content} style={s.text} />}
            </TouchableOpacity>

            {/* A mentioned booking's important details, under the message. */}
            <BookingMentionCards text={msg.content} alignEnd={isMine} />

            {grouped.length > 0 && (
              <View style={[s.reactions, isMine ? s.reactionsMine : null]}>
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
            {/* Under the bubble, on the sender's side: name · time and your sent / seen. */}
            <View style={[s.meta, isMine ? s.metaMine : s.metaTheirs]}>
              {showName && <Text style={s.name} numberOfLines={1}>{isMine ? 'You' : senderName}</Text>}
              {showName && <Text style={s.dot}>·</Text>}
              <Text style={s.time}>{time}</Text>
              {isMine && seen !== undefined && <ReadTicks seen={seen && !pending} size={13} />}
            </View>
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
        <TextInput
          ref={inputRef}
          value={value}
          onChangeText={(v) => { mention?.onText(v); onChangeText?.(v) }}
          onSelectionChange={(e) => mention?.onSelection(e.nativeEvent.selection.end)}
          // Late, so a tap on the booking list still lands first.
          onBlur={() => setTimeout(() => mention?.close(), 150)}
          onFocus={onFocus}
          placeholder="Message"
          placeholderTextColor="rgba(255,255,255,0.3)"
          style={s.input}
          multiline
          maxLength={5000}
        />
        <View style={s.composerActions}>
          <View style={s.flex} />
          <TouchableOpacity onPress={onPhoto} activeOpacity={0.7} style={s.iconBtn}
            hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }} accessibilityLabel="Send a photo">
            <ImagePlus size={20} color={C.muted} />
          </TouchableOpacity>
          <TouchableOpacity onPress={onToggleEmoji} activeOpacity={0.7} style={[s.iconBtn, emojiOpen && s.iconBtnOn]}
            hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }} accessibilityLabel="Emoji">
            <Smile size={20} color={emojiOpen ? C.cyan : C.muted} />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={onSend}
            disabled={!canSend}
            activeOpacity={0.75}
            style={[s.sendBtn, !canSend && s.sendBtnOff]}
            accessibilityLabel="Send"
          >
            <Send size={15} color={canSend ? C.bg : 'rgba(255,255,255,0.3)'} />
            <Text style={[s.sendText, !canSend && s.sendTextOff]}>Send</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  )
}

const s = StyleSheet.create({
  flex: { flex: 1 },

  swipeRow:       { flexDirection: 'row', alignItems: 'center' },
  swipeRowMine:   { justifyContent: 'flex-end' },
  swipeRowTheirs: { justifyContent: 'flex-start' },
  swipeIcon:      { width: 28, height: 28, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },

  row:       { flexDirection: 'row', alignItems: 'flex-end', gap: 12, flexShrink: 1, maxWidth: '100%' },
  // With the 28 px swipe icon beside it, Untitled UI's 40 / 32 px gutters.
  rowMine:   { paddingLeft: 12 },
  rowTheirs: { paddingRight: 4 },
  pending:   { opacity: 0.6 },

  avatar:       { width: 32, height: 32, borderRadius: 16, backgroundColor: '#2a2a2a', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center' },
  avatarText:   { color: 'rgba(255,255,255,0.75)', fontFamily: FONTS.alegreyaSans.bold, fontSize: 11 },
  avatarSpacer: { width: 32 },
  onlineDot:    { position: 'absolute', right: 0, bottom: 0, width: 8, height: 8, borderRadius: 4, backgroundColor: '#3af626', borderWidth: 1.5, borderColor: C.bg },

  article: { flexShrink: 1, gap: 6 },
  meta:       { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 2 },
  metaMine:   { alignSelf: 'flex-end' },
  metaTheirs: { alignSelf: 'flex-start' },
  name:       { flexShrink: 1, color: C.label, fontFamily: FONTS.alegreyaSans.medium, fontSize: 12 },
  dot:        { color: 'rgba(255,255,255,0.3)', fontSize: 12 },
  time:       { color: C.muted, fontFamily: FONTS.alegreyaSans.regular, fontSize: 12 },
  footer:     { alignSelf: 'flex-end', marginTop: 2 },

  bubble:       { borderRadius: 8, borderWidth: 1, borderColor: C.ring, paddingHorizontal: 12, paddingVertical: 8 },
  bubbleMine:   { alignSelf: 'flex-end', borderBottomRightRadius: 0, backgroundColor: C.bg, paddingRight: 16 },
  bubbleTheirs: { alignSelf: 'flex-start', borderBottomLeftRadius: 0, backgroundColor: C.raised },
  bubblePhoto:  { padding: 6, paddingRight: 6 },
  text:         { color: C.white, fontFamily: FONTS.alegreyaSans.regular, fontSize: 16, lineHeight: 23 },

  quote:     { backgroundColor: C.bg, borderRadius: 8, borderWidth: 1, borderColor: C.ring, borderLeftWidth: 3, borderLeftColor: C.cyan, paddingHorizontal: 12, paddingVertical: 8, marginBottom: 6 },
  quoteName: { color: C.cyan, fontFamily: FONTS.alegreyaSans.medium, fontSize: 12 },
  quoteText: { color: C.quote, fontFamily: FONTS.alegreyaSans.regular, fontSize: 14, lineHeight: 19 },

  reactions:       { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  reactionsMine:   { justifyContent: 'flex-end' },
  reaction:        { flexDirection: 'row', alignItems: 'center', gap: 4, height: 24, paddingHorizontal: 8, borderRadius: 16, backgroundColor: C.raised, borderWidth: 1, borderColor: C.ring },
  reactionOn:      { backgroundColor: 'rgba(77,249,237,0.12)', borderColor: 'rgba(77,249,237,0.35)' },
  reactionEmoji:   { fontSize: 13 },
  reactionCount:   { color: C.quote, fontFamily: FONTS.alegreyaSans.medium, fontSize: 12 },
  reactionCountOn: { color: C.cyan },

  divider:     { flexDirection: 'row', alignItems: 'center', gap: 8, marginVertical: 8 },
  dividerLine: { flex: 1, height: 1, backgroundColor: C.ring },
  dividerText: { color: C.muted, fontFamily: FONTS.alegreyaSans.medium, fontSize: 14 },

  typingBubble: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, width: 40, height: 28, alignSelf: 'flex-start', borderRadius: 8, borderBottomLeftRadius: 0, backgroundColor: C.raised, borderWidth: 1, borderColor: C.ring },
  typingDot:    { width: 4, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.6)' },
  typingDotDim: { backgroundColor: 'rgba(255,255,255,0.35)' },

  jumpWrap:        { position: 'absolute', left: 0, right: 0, bottom: '100%', marginBottom: 10, alignItems: 'center', zIndex: 30 },
  jumpBtn:         { width: 38, height: 38, borderRadius: 19, backgroundColor: '#222', borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center', elevation: 8, shadowColor: '#000', shadowOpacity: 0.4, shadowRadius: 8, shadowOffset: { width: 0, height: 3 } },
  composerBar:     { paddingHorizontal: 12, paddingVertical: 10, backgroundColor: C.bg, borderTopWidth: 1, borderTopColor: '#2a2a2a' },
  composer:        { borderRadius: 12, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', backgroundColor: 'rgba(255,255,255,0.03)' },
  composerQuote:   { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 10, marginTop: 10, marginBottom: 0 },
  input:           { color: C.white, fontFamily: FONTS.alegreyaSans.regular, fontSize: 16, paddingHorizontal: 14, paddingTop: 12, paddingBottom: 6, minHeight: 44, maxHeight: 120 },
  composerActions: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingBottom: 8 },
  iconBtn:         { padding: 6, borderRadius: 6 },
  iconBtnOn:       { backgroundColor: 'rgba(77,249,237,0.1)' },
  sendBtn:         { flexDirection: 'row', alignItems: 'center', gap: 6, marginLeft: 4, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8, backgroundColor: C.cyan },
  sendBtnOff:      { backgroundColor: 'rgba(255,255,255,0.05)' },
  sendText:        { color: C.bg, fontFamily: FONTS.alegreyaSans.bold, fontSize: 14 },
  sendTextOff:     { color: 'rgba(255,255,255,0.3)' },
})
