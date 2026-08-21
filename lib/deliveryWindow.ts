import { phToday, hasServerTime } from './serverTime'

/**
 * Whether a booking is runnable yet.
 *
 * Starting navigation is not a read-only act: from the nav screen the driver can
 * confirm the pickup, confirm each drop-off and complete the booking, all with
 * real timestamps and proof photos. Opening it days early is how a delivery ends
 * up stamped before the day it was meant to happen, so the button is gated.
 *
 * The rule is "not before", never "is today" — a booking whose day has passed
 * has to stay runnable, or a job that slipped by a day strands the driver.
 *
 * This is the app's half of the gate. The server enforces the same rule on the
 * pickup itself, which is the half that actually holds.
 */

export interface NavigationGate {
  /** The scheduled day hasn't arrived yet. */
  locked: boolean
  /** `YYYY-MM-DD` the booking is scheduled for, when it is still ahead. */
  scheduledFor: string | null
  /** Why navigation can't start, if it can't. */
  reason: 'not_yet' | 'not_assigned' | 'cancelled' | null
}

const OPEN: NavigationGate = { locked: false, scheduledFor: null, reason: null }

interface GateInput {
  status?:        string | null
  schedule_date?: string | null
}

export function navigationGate(booking: GateInput | null | undefined): NavigationGate {
  if (!booking) return OPEN

  // Already on the road: a trip in progress must always be resumable, whatever
  // the date says and whatever the clock knows.
  if (booking.status === 'in_transit' || booking.status === 'completed') return OPEN

  if (booking.status === 'cancelled') {
    return { locked: true, scheduledFor: null, reason: 'cancelled' }
  }

  if (booking.status && booking.status !== 'assigned') {
    return { locked: true, scheduledFor: booking.schedule_date ?? null, reason: 'not_assigned' }
  }

  // Never reached the server, so we don't actually know what day it is. Staying
  // permissive is the right failure: the server still refuses an early pickup.
  if (!hasServerTime()) return OPEN

  const scheduled = booking.schedule_date?.slice(0, 10)
  if (!scheduled) return OPEN

  if (scheduled > phToday()) {
    return { locked: true, scheduledFor: scheduled, reason: 'not_yet' }
  }

  return OPEN
}

/** "Fri, Aug 25" — for telling the driver when the job opens. */
export function formatGateDate(day: string): string {
  const parsed = new Date(`${day}T00:00:00+08:00`)
  if (Number.isNaN(parsed.getTime())) return day
  return parsed.toLocaleDateString('en-PH', {
    weekday: 'short', month: 'short', day: 'numeric', timeZone: 'Asia/Manila',
  })
}
