import { create } from 'zustand'
import { driverApi, DriverAvailabilityStatus } from '../api/driver.api'

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
  loading:    boolean
  error:      string | null

  // The month calendar behind the pill: which month is loaded, the days ticked
  // in it, and the server's idea of today (the device clock never decides which
  // days are already past).
  month:       string | null
  days:        string[]
  today:       string | null
  loadingDays: boolean
  savingDays:  boolean

  refresh:      () => Promise<void>
  loadDays:     (month: string) => Promise<void>
  saveDays:     (month: string, days: string[]) => Promise<void>
  reset:        () => void
}

export const useAvailabilityStore = create<AvailabilityStore>((set, get) => ({
  status:     null,
  onDelivery: false,
  loading:    false,
  error:      null,

  month:       null,
  days:        [],
  today:       null,
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
        status: next.status, onDelivery: next.on_delivery, error: null,
        month: month.month, days: month.days, today: month.today,
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
    set({ loadingDays: true, days: get().month === month ? get().days : [], month })
    try {
      const next = await driverApi.getAvailabilityDays(month)
      set({ month: next.month, days: next.days, today: next.today, error: null })
    } catch {
      set({ error: 'Could not load your calendar' })
    } finally {
      set({ loadingDays: false })
    }
  },

  saveDays: async (month, days) => {
    // Optimistic: the calendar closes on the driver's tap, so the ticks they
    // just made have to survive the round trip. A failure re-reads the month on
    // the next open, which is the server's truth either way.
    set({ savingDays: true, month, days })
    try {
      const next = await driverApi.setAvailabilityDays(month, days)
      set({ month: next.month, days: next.days, today: next.today, error: null })
    } catch (err: any) {
      set({ error: err?.response?.data?.message ?? 'Could not save your calendar' })
      throw err
    } finally {
      set({ savingDays: false })
    }
  },

  reset: () => set({
    status: null, onDelivery: false, loading: false, error: null,
    month: null, days: [], today: null, loadingDays: false, savingDays: false,
  }),
}))
