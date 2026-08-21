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

export const driverApi = {
  getAvailability: async (): Promise<DriverAvailability> => {
    const { data } = await api.get('/driver/availability')
    return data.data
  },

  setAvailability: async (status: 'available' | 'unavailable'): Promise<DriverAvailability> => {
    const { data } = await api.patch('/driver/availability', { status })
    return data.data
  },
}
