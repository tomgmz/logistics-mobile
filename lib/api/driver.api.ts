import api from './auth.api'

/**
 * Whether the driver can be given delivery work.
 *
 * There is no on/off switch — the calendar is the driver's opt-in, and the days
 * they tick are the only days operations can put them on a booking. This status
 * records the things that stop work regardless of any plan: 'assigned' while a
 * delivery is in flight (system-owned), and 'on_leave' / 'inactive' when the
 * fleet manager has stood them down. 'available' and 'unavailable' are left over
 * from the old switch and mean nothing beyond "not stopped".
 */
export type DriverAvailabilityStatus =
  | 'available'
  | 'unavailable'
  | 'assigned'
  | 'on_leave'
  | 'inactive'

export interface DriverAvailability {
  driver_id:   string
  status:      DriverAvailabilityStatus
  // True while out on a delivery. Nothing the driver can change from their side.
  on_delivery: boolean
}

/**
 * The driver's plan for one calendar month: the days they can be given a
 * delivery, ticked on the calendar behind the availability pill.
 *
 * These days ARE the opt-in. A day left unticked is a day the driver cannot be
 * assigned, and a month left empty means no work that month — so the calendar is
 * the one thing that decides whether the driver gets given a delivery at all.
 */
export interface DriverAvailabilityMonth {
  driver_id: string
  /** 'YYYY-MM' */
  month: string
  /** Marked days, ascending, as 'YYYY-MM-DD'. */
  days: string[]
  /** Today in Philippine time — the server's day, not the device's. */
  today: string
}

export const driverApi = {
  getAvailability: async (): Promise<DriverAvailability> => {
    const { data } = await api.get('/driver/availability')
    return data.data
  },

  getAvailabilityDays: async (month: string): Promise<DriverAvailabilityMonth> => {
    const { data } = await api.get('/driver/availability/days', { params: { month } })
    return data.data
  },

  // The whole month is sent, not a diff — the calendar screen holds the month,
  // so a save means "these are my days". Days already past are ignored server
  // side, so a stale screen can never rewrite history.
  setAvailabilityDays: async (month: string, days: string[]): Promise<DriverAvailabilityMonth> => {
    const { data } = await api.put('/driver/availability/days', { month, days })
    return data.data
  },
}
