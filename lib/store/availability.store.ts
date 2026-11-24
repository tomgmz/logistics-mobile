import { create } from 'zustand'
import { driverApi, DriverAvailabilityMonth, DriverAvailabilityStatus } from '../api/driver.api'

/** Next month's first week, when it is open (from this month's second-to-last week). */
export interface NextMonthDays {
  month:    string
  days:     string[]
  editable: string[]
}

/**
 * The driver's availability for delivery work, mirrored from the server.
 *
 * The driver has no on/off switch: the days they tick on the calendar are the
 * only days operations can put them on a booking. So this store holds two
 * things — whether a delivery is in flight right now (`onDelivery`, the server's
 * call and not the driver's), and the month of ticked days that decides
 * everything else.
 */

interface AvailabilityStore {
  status:     DriverAvailabilityStatus | null
  onDelivery: boolean
  // The delivery has left — "On delivery". Crewed but not yet left is "Assigned".
  inTransit:  boolean
  loading:    boolean
  error:      string | null

  // The month calendar behind the pill: which month is loaded, the days ticked
  // in it, and the server's idea of today (the device clock never decides which
  // days are already past).
  month:       string | null
  days:        string[]
  today:       string | null
  // The days of `month` the driver may change now (server's rule); null from an
  // older backend, which means "today onward".
  editable:    string[] | null
  // This week already has a set day, so the whole week is fixed.
  weekLocked:  boolean
  next:        NextMonthDays | null
  loadingDays: boolean
  savingDays:  boolean

  refresh:      () => Promise<void>
  loadDays:     (month: string) => Promise<void>
  /** Saves the month; `nextDays` (next month's first week) only when it changed. */
  saveDays:     (month: string, days: string[], nextDays?: string[] | null) => Promise<void>
  reset:        () => void
}

/** The calendar fields of a month read, as store state. */
function monthState(m: DriverAvailabilityMonth) {
  return {
    month:      m.month,
    days:       m.days,
    today:      m.today,
    editable:   m.editable ?? null,
    weekLocked: m.week_locked ?? false,
    next:       m.next ? { month: m.next.month, days: m.next.days, editable: m.next.editable ?? [] } : null,
  }
}

export const useAvailabilityStore = create<AvailabilityStore>((set, get) => ({
  status:     null,
  onDelivery: false,
  inTransit:  false,
  loading:    false,
  error:      null,

  month:       null,
  days:        [],
  today:       null,
  editable:    null,
  weekLocked:  false,
  next:        null,
  loadingDays: false,
  savingDays:  false,

  refresh: async () => {
    set({ loading: true })
    try {
      // The pill reads "can I work today?", which is a question about the
      // calendar — so the current month comes back with the status rather than
      // waiting for the driver to open the calendar. The device clock only picks
      // which month to ask for; the `today` in the reply is what it is compared
      // against.
      const now      = new Date()
      const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`

      const [next, month] = await Promise.all([
        driverApi.getAvailability(),
        driverApi.getAvailabilityDays(monthKey),
      ])
      set({
        status: next.status, onDelivery: next.on_delivery, inTransit: next.in_transit ?? false, error: null,
        ...monthState(month),
      })
    } catch {
      // Offline or no driver profile — leave the last known state in place so the
      // pill doesn't flicker to an unknown value.
      set({ error: 'Could not reach the server' })
    } finally {
      set({ loading: false })
    }
  },

  loadDays: async (month) => {
    // Switching months blanks the grid rather than showing the previous month's
    // ticks against the new month's dates.
    const same = get().month === month
    set({ loadingDays: true, days: same ? get().days : [], next: same ? get().next : null, month })
    try {
      const next = await driverApi.getAvailabilityDays(month)
      set({ ...monthState(next), error: null })
    } catch {
      set({ error: 'Could not load your calendar' })
    } finally {
      set({ loadingDays: false })
    }
  },

  saveDays: async (month, days, nextDays) => {
    // Optimistic: the calendar closes on the driver's tap, so the ticks they
    // just made have to survive the round trip. A failure re-reads the month on
    // the next open, which is the server's truth either way.
    const pending = get().next
    set({
      savingDays: true, month, days,
      next: pending && nextDays ? { ...pending, days: nextDays } : pending,
    })
    try {
      // Next month first, then this month: the reply to this month's save
      // carries both months (and whether this week is now fixed).
      if (pending && nextDays) await driverApi.setAvailabilityDays(pending.month, nextDays)
      const next = await driverApi.setAvailabilityDays(month, days)
      set({ ...monthState(next), error: null })
    } catch (err: any) {
      set({ error: err?.response?.data?.message ?? 'Could not save your calendar' })
      throw err
    } finally {
      set({ savingDays: false })
    }
  },

  reset: () => set({
    status: null, onDelivery: false, inTransit: false, loading: false, error: null,
    month: null, days: [], today: null, editable: null, weekLocked: false, next: null,
    loadingDays: false, savingDays: false,
  }),
}))
