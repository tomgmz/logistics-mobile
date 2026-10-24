import React, { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { View, Text, ScrollView, TouchableOpacity, ActivityIndicator, StyleSheet, type TextStyle } from 'react-native'
import { Package } from 'lucide-react-native'
import { messagingApi } from '../../lib/api/messaging.api'
import { FONTS } from '../../lib/config/fonts'
import {
  activeMentionQuery, bookingStatusLabel, formatSchedule, insertMention, mentionedBookingRefs, splitMentions,
} from '../../lib/bookingMentions'
import type { BookingMentionDetails, MentionableBooking } from '../../types/messaging.types'

/*
 * Booking mentions on the phone, same as the web (components/messaging/
 * BookingMention.tsx there): booking numbers picked out in the text, the
 * important details of each under the message, and the "@" list in the
 * composer. The server only returns bookings the driver is crewed on.
 */

/** Same fixed status colours as the web (lib/palette.ts there). */
const STATUS_COLOR: Record<string, string> = {
  pending: '#FFEA00', booked: '#FFEA00',
  approved: '#8A38F5',
  assigned: '#FF7A30',
  in_transit: '#4DF9ED', arrived: '#4DF9ED',
  delivered: '#3AF626', completed: '#3AF626',
  cancelled: '#F62626',
}
const statusColor = (s: string) => STATUS_COLOR[s] ?? '#9f9c9c'

/* ── Details cache: one request per burst of messages, kept for a minute ── */

const TTL_MS   = 60_000
const BATCH_MS = 40
const cache    = new Map<string, { value: BookingMentionDetails | null; at: number }>()
const queued   = new Set<string>()
const inFlight = new Set<string>()
const listeners = new Set<() => void>()
let timer: ReturnType<typeof setTimeout> | null = null
let version = 0

function emit() { version++; listeners.forEach(l => l()) }

function flush() {
  timer = null
  const refs = [...queued].slice(0, 20)
  refs.forEach(r => { queued.delete(r); inFlight.add(r) })
  if (queued.size) timer = setTimeout(flush, BATCH_MS)
  if (!refs.length) return
  messagingApi.getBookingMentionDetails(refs)
    .then(rows => {
      const now = Date.now()
      for (const ref of refs) cache.set(ref, { value: rows.find(r => r.reference_number === ref) ?? null, at: now })
    })
    .catch(() => { /* left uncached, so the next render tries again */ })
    .finally(() => { refs.forEach(r => inFlight.delete(r)); emit() })
}

function request(refs: string[]) {
  const now = Date.now()
  for (const ref of refs) {
    const hit = cache.get(ref)
    if ((hit && now - hit.at < TTL_MS) || inFlight.has(ref)) continue
    queued.add(ref)
  }
  if (queued.size && !timer) timer = setTimeout(flush, BATCH_MS)
}

const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l) } }

function useMentionDetails(refs: string[]): BookingMentionDetails[] {
  const key = refs.join(',')
  useEffect(() => { if (key) request(key.split(',')) }, [key])
  const v = useSyncExternalStore(subscribe, () => version)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => refs.map(r => cache.get(r)?.value).filter((d): d is BookingMentionDetails => !!d), [key, v])
}

/* ── In a message ──────────────────────────────────────────────────────── */

/** Message text with each booking number picked out. */
export function MentionText({ text, style }: { text: string; style: TextStyle | TextStyle[] }) {
  const parts = splitMentions(text)
  return (
    <Text style={style}>
      {parts.map((p, i) => p.ref
        ? <Text key={i} style={s.mention}>{p.text}</Text>
        : p.text)}
    </Text>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={s.row}>
      <Text style={s.rowLabel}>{label}</Text>
      <View style={s.rowValue}>{children}</View>
    </View>
  )
}

const Muted = ({ children }: { children: string }) => <Text style={[s.value, s.valueMuted]}>{children}</Text>

export function BookingMentionCard({ booking }: { booking: BookingMentionDetails }) {
  const schedule = formatSchedule(booking.schedule_date, booking.call_time)
  const color    = statusColor(booking.status)
  const many     = booking.drop_offs.length > 1
  return (
    <View style={s.card}>
      <View style={s.cardHeader}>
        <View style={s.cardIcon}><Package size={14} color="#4df9ed" /></View>
        <Text style={s.cardRef} numberOfLines={1}>{booking.reference_number}</Text>
        <View style={[s.badge, { backgroundColor: `${color}1a`, borderColor: `${color}40` }]}>
          <View style={[s.badgeDot, { backgroundColor: color }]} />
          <Text style={[s.badgeText, { color }]}>{bookingStatusLabel(booking.status)}</Text>
        </View>
      </View>
      {booking.limited ? (
        <>
          {schedule ? <Row label="Schedule"><Text style={s.value}>{schedule}</Text></Row> : null}
          <Text style={[s.value, s.valueMuted]}>You aren{"'"}t on this booking, so only its status and schedule show.</Text>
        </>
      ) : (
      <>
      {booking.company_name ? <Row label="Client"><Text style={s.value}>{booking.company_name}</Text></Row> : null}
      {schedule ? <Row label="Schedule"><Text style={s.value}>{schedule}</Text></Row> : null}
      {booking.origin ? <Row label="Pickup"><Text style={s.value}>{booking.origin}</Text></Row> : null}
      {booking.drop_offs.length > 0 && (
        <Row label={many ? `Drop-offs (${booking.drop_offs.length})` : 'Drop-off'}>
          {booking.drop_offs.map((a, i) => <Text key={i} style={s.value}>{many ? `${i + 1}. ${a}` : a}</Text>)}
        </Row>
      )}
      <Row label="Vehicle">{booking.vehicle ? <Text style={s.value}>{booking.vehicle}</Text> : <Muted>Not assigned yet</Muted>}</Row>
      <Row label={booking.drivers.length > 1 ? 'Drivers' : 'Driver'}>
        {booking.drivers.length ? <Text style={s.value}>{booking.drivers.join(', ')}</Text> : <Muted>Not assigned yet</Muted>}
      </Row>
      </>
      )}
    </View>
  )
}

/** The cards for every booking a message mentions that the reader may see. */
export function BookingMentionCards({ text, alignEnd }: { text: string; alignEnd?: boolean }) {
  const refs    = useMemo(() => mentionedBookingRefs(text), [text])
  const details = useMentionDetails(refs)
  if (!details.length) return null
  return (
    <View style={[s.cards, alignEnd ? s.cardsEnd : s.cardsStart]}>
      {details.map(b => <BookingMentionCard key={b.booking_id} booking={b} />)}
    </View>
  )
}

/* ── In the composer ───────────────────────────────────────────────────── */

/** Typing "@" opens the list of bookings; more letters or digits narrow it. */
export function useBookingMentionPicker(value: string, setValue: (next: string) => void) {
  const [mention, setMention] = useState<{ start: number; query: string } | null>(null)
  const [items, setItems]     = useState<MentionableBooking[]>([])
  const [itemsFor, setItemsFor] = useState<string | null>(null)
  const caret   = useRef(0)
  const current = useRef(value)
  current.current = value

  /** From the field's onChangeText: the caret is assumed to move with the edit. */
  const onText = useCallback((next: string) => {
    caret.current = Math.max(0, Math.min(next.length, caret.current + next.length - current.current.length))
    current.current = next
    setMention(activeMentionQuery(next, caret.current))
  }, [])

  /** From the field's onSelectionChange. */
  const onSelection = useCallback((end: number) => {
    caret.current = end
    setMention(activeMentionQuery(current.current, end))
  }, [])

  const query = mention?.query ?? null
  useEffect(() => {
    if (query === null) return
    let stale = false
    const t = setTimeout(() => {
      messagingApi.searchMentionableBookings(query)
        .then(rows => { if (!stale) { setItems(rows); setItemsFor(query) } })
        .catch(() => { if (!stale) { setItems([]); setItemsFor(query) } })
    }, 200)
    return () => { stale = true; clearTimeout(t) }
  }, [query])

  const pick = useCallback((b: MentionableBooking) => {
    if (!mention) return
    const next = insertMention(current.current, mention.start, caret.current, b.reference_number)
    caret.current = next.caret
    current.current = next.text
    setValue(next.text)
    setMention(null)
  }, [mention, setValue])

  const close = useCallback(() => setMention(null), [])

  return { open: mention !== null, items, loading: query !== null && itemsFor !== query, pick, close, onText, onSelection }
}

export type BookingMentionPicker = ReturnType<typeof useBookingMentionPicker>

/** The list above the composer. Place inside a `position: relative` box. */
export function BookingMentionMenu({ picker }: { picker: BookingMentionPicker }) {
  if (!picker.open) return null
  return (
    <View style={s.menu}>
      <View style={s.menuHeader}>
        <Text style={s.menuTitle}>Mention a booking</Text>
        {picker.loading && <ActivityIndicator size="small" color="rgba(255,255,255,0.45)" />}
      </View>
      <ScrollView style={s.menuList} keyboardShouldPersistTaps="always" nestedScrollEnabled>
        {!picker.loading && picker.items.length === 0 && <Text style={s.menuEmpty}>No bookings match.</Text>}
        {picker.items.map(b => (
          <TouchableOpacity key={b.booking_id} onPress={() => picker.pick(b)} activeOpacity={0.7} style={s.menuItem}>
            <View style={[s.menuDot, { backgroundColor: statusColor(b.status) }]} />
            <View style={s.flex}>
              <Text style={s.menuRef} numberOfLines={1}>{b.reference_number}</Text>
              <Text style={s.menuMeta} numberOfLines={1}>
                {[b.company_name, bookingStatusLabel(b.status), formatSchedule(b.schedule_date, null)].filter(Boolean).join(' · ')}
              </Text>
            </View>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  )
}

const s = StyleSheet.create({
  flex: { flex: 1 },
  mention: { color: '#4df9ed', fontFamily: FONTS.alegreyaSans.medium, backgroundColor: 'rgba(77,249,237,0.1)' },

  cards:      { gap: 6, width: '100%', maxWidth: 380 },
  cardsEnd:   { alignSelf: 'flex-end' },
  cardsStart: { alignSelf: 'flex-start' },
  card:       { gap: 6, padding: 12, borderRadius: 8, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', backgroundColor: '#0a0a0a' },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 2 },
  cardIcon:   { width: 28, height: 28, borderRadius: 6, backgroundColor: 'rgba(77,249,237,0.1)', alignItems: 'center', justifyContent: 'center' },
  cardRef:    { flex: 1, color: '#fff', fontFamily: FONTS.alegreyaSans.bold, fontSize: 15 },
  badge:      { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999, borderWidth: 1 },
  badgeDot:   { width: 6, height: 6, borderRadius: 3 },
  badgeText:  { fontFamily: FONTS.alegreyaSans.medium, fontSize: 12 },
  row:        { flexDirection: 'row', gap: 12 },
  rowLabel:   { width: 78, color: 'rgba(255,255,255,0.45)', fontFamily: FONTS.alegreyaSans.regular, fontSize: 14, lineHeight: 19 },
  rowValue:   { flex: 1, gap: 2 },
  value:      { color: 'rgba(255,255,255,0.85)', fontFamily: FONTS.alegreyaSans.regular, fontSize: 14, lineHeight: 19 },
  valueMuted: { color: 'rgba(255,255,255,0.4)' },

  menu:       { position: 'absolute', left: 12, right: 12, bottom: '100%', marginBottom: 6, borderRadius: 12, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', backgroundColor: '#161616', overflow: 'hidden', zIndex: 40, elevation: 12 },
  menuHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.06)' },
  menuTitle:  { color: 'rgba(255,255,255,0.45)', fontFamily: FONTS.alegreyaSans.medium, fontSize: 12 },
  menuList:   { maxHeight: 240 },
  menuEmpty:  { color: 'rgba(255,255,255,0.4)', fontFamily: FONTS.alegreyaSans.regular, fontSize: 14, padding: 12 },
  menuItem:   { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 12, paddingVertical: 10 },
  menuDot:    { width: 8, height: 8, borderRadius: 4 },
  menuRef:    { color: '#fff', fontFamily: FONTS.alegreyaSans.medium, fontSize: 15 },
  menuMeta:   { color: 'rgba(255,255,255,0.45)', fontFamily: FONTS.alegreyaSans.regular, fontSize: 12 },
})
