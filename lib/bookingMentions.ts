/*
 * Booking mentions in Messages: "@BK-202610-00033" in a message's text. The
 * message only carries the number; the details card under it is fetched per
 * reader, so someone who can't see that booking only sees the number.
 *
 * A full booking number counts whether or not it was typed with "@" (the user
 * may pick from the "@" list or type the whole number). Same rules as the web
 * (logistics-frontend/src/lib/bookingMentions.ts) — keep the two in step.
 */

/** A whole booking number, optionally after "@". */
export const BOOKING_MENTION_RE = /@?\b(BK-\d{6}-\d{5,})\b/gi

/** Every match in `text` (a fresh regex each time, so no shared lastIndex). */
function matches(text: string): RegExpExecArray[] {
  const re  = new RegExp(BOOKING_MENTION_RE.source, BOOKING_MENTION_RE.flags)
  const out: RegExpExecArray[] = []
  for (let m = re.exec(text); m; m = re.exec(text)) out.push(m)
  return out
}

/** The distinct booking numbers a text mentions, in order, upper-cased. */
export function mentionedBookingRefs(text: string | null | undefined): string[] {
  if (!text) return []
  const out: string[] = []
  for (const m of matches(text)) {
    const ref = m[1].toUpperCase()
    if (!out.includes(ref)) out.push(ref)
  }
  return out
}

/** Splits text into plain runs and mentions, for highlighting. */
export function splitMentions(text: string): Array<{ text: string; ref?: string }> {
  const parts: Array<{ text: string; ref?: string }> = []
  let last = 0
  for (const m of matches(text)) {
    const at = m.index
    if (at > last) parts.push({ text: text.slice(last, at) })
    parts.push({ text: m[0], ref: m[1].toUpperCase() })
    last = at + m[0].length
  }
  if (last < text.length) parts.push({ text: text.slice(last) })
  return parts
}

/**
 * The "@…" being typed just before the caret, or null. "@" must start the
 * text or follow a space, so an email address doesn't open the list.
 */
export function activeMentionQuery(text: string, caret: number): { start: number; query: string } | null {
  const before = text.slice(0, caret)
  const m = /(^|\s)@([\w-]{0,20})$/.exec(before)
  if (!m) return null
  return { start: before.length - m[2].length - 1, query: m[2] }
}

/** Replaces the "@…" being typed with the chosen number (and a space). */
export function insertMention(text: string, start: number, caret: number, ref: string): { text: string; caret: number } {
  const insert = `@${ref} `
  const next   = text.slice(0, start) + insert + text.slice(caret).replace(/^\s+/, '')
  return { text: next, caret: start + insert.length }
}

/** "in_transit" → "In Transit". */
export function bookingStatusLabel(status: string): string {
  return status.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/**
 * "2026-10-27" + "16:00:00" → "Oct 27, 2026 · 4:00 PM". Read from the parts
 * rather than `new Date(...)`, which Safari rejects for these formats.
 */
export function formatSchedule(date: string | null, time: string | null): string | null {
  const d = date ? /^(\d{4})-(\d{2})-(\d{2})/.exec(date) : null
  const t = time ? /^(\d{1,2}):(\d{2})/.exec(time) : null
  const day = d ? `${MONTHS[Number(d[2]) - 1]} ${Number(d[3])}, ${d[1]}` : null
  let clock: string | null = null
  if (t) {
    const h = Number(t[1])
    clock = `${h % 12 || 12}:${t[2]} ${h < 12 ? 'AM' : 'PM'}`
  }
  return [day, clock].filter(Boolean).join(' · ') || null
}
