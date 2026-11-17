/**
 * The driver's call time has its own day since 2026-11-17: the booking day or
 * the day before (a 12:00 AM start can have a 10:00 PM call the night before).
 * The screens show the time as before and add the day only when it differs
 * from the booking day, e.g. "10:00 PM (Nov 11)".
 */
interface CallDayFields {
  schedule_date?:    string | null
  driver_call_time?: string | null
  driver_call_date?: string | null
}

export function callDayNote(b: CallDayFields): string {
  if (!b.driver_call_time || !b.driver_call_date) return ''
  const day = b.driver_call_date.slice(0, 10)
  if (!b.schedule_date || day === b.schedule_date.slice(0, 10)) return ''
  const d = new Date(`${day}T00:00:00Z`)
  if (Number.isNaN(d.getTime())) return ''
  return ` (${d.toLocaleDateString('en-PH', { month: 'short', day: 'numeric', timeZone: 'UTC' })})`
}
