import { create } from 'zustand'
import { driverApi, DriverAvailabilityStatus } from '../api/driver.api'

/**
 * The driver's availability for delivery work, mirrored from the server.
 *
 * Besides holding the switch state, this store is what notices a delivery has
 * ENDED: the server drops a driver from 'assigned' back to 'unavailable' when
 * the booking completes, so a refresh that sees that transition raises
 * `promptReAvailable`. The assignments screen turns that into the "ready for
 * another delivery?" prompt — which is why the transition is tracked here rather
 * than fired from the completion screen: the completion may sync later, from a
 * dead zone, long after that screen is gone.
 */

interface AvailabilityStore {
  status:     DriverAvailabilityStatus | null
  canToggle:  boolean
  loading:    boolean
  saving:     boolean
  error:      string | null
  // Set once when a delivery has just ended; cleared by the screen that shows
  // the prompt.
  promptReAvailable: boolean

  refresh:      () => Promise<void>
  setStatus:    (status: 'available' | 'unavailable') => Promise<void>
  clearPrompt:  () => void
  reset:        () => void
}

export const useAvailabilityStore = create<AvailabilityStore>((set, get) => ({
  status:    null,
  canToggle: false,
  loading:   false,
  saving:    false,
  error:     null,
  promptReAvailable: false,

  refresh: async () => {
    set({ loading: true })
    try {
      const previous = get().status
      const next     = await driverApi.getAvailability()
      set({
        status:    next.status,
        canToggle: next.can_toggle,
        error:     null,
        // Coming off a delivery: the server stood them down, so ask whether they
        // want to go back in the pool.
        promptReAvailable:
          get().promptReAvailable ||
          (previous === 'assigned' && next.status === 'unavailable'),
      })
    } catch {
      // Offline or no driver profile — leave the last known state in place so the
      // toggle doesn't flicker to an unknown value.
      set({ error: 'Could not reach the server' })
    } finally {
      set({ loading: false })
    }
  },

  setStatus: async (status) => {
    set({ saving: true })
    try {
      const next = await driverApi.setAvailability(status)
      set({ status: next.status, canToggle: next.can_toggle, error: null, promptReAvailable: false })
    } catch (err: any) {
      set({ error: err?.response?.data?.message ?? 'Could not update your availability' })
      throw err
    } finally {
      set({ saving: false })
    }
  },

  clearPrompt: () => set({ promptReAvailable: false }),

  reset: () => set({
    status: null, canToggle: false, loading: false, saving: false,
    error: null, promptReAvailable: false,
  }),
}))
