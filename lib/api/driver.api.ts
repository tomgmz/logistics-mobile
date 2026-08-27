import api from './auth.api'

/**
 * The driver's own switch for accepting delivery work.
 *
 * A driver account starts 'unavailable' — operations only sees drivers who have
 * turned themselves on. 'assigned' is set by the system while a delivery is in
 * flight and cannot be toggled out of; finishing the delivery drops the driver
 * back to 'unavailable' so they opt in again when they are ready for the next one.
 */
export type DriverAvailabilityStatus =
  | 'available'
  | 'unavailable'
  | 'assigned'
  | 'on_leave'
  | 'inactive'

export interface DriverAvailability {
  driver_id:  string
  status:     DriverAvailabilityStatus
  // False while out on a delivery, or when the account is on leave / inactive.
  can_toggle: boolean
}

/**
 * The driver's plan for one calendar month: the days they can be given a
 * delivery, ticked on the calendar behind the availability pill.
 *
 * A month with no days is a month the driver never filled in — operations reads
 * that as "no objection", not "unavailable".
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

  setAvailability: async (status: 'available' | 'unavailable'): Promise<DriverAvailability> => {
    const { data } = await api.patch('/driver/availability', { status })
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
