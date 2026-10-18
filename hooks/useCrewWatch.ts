import { useCallback, useRef } from 'react'

import api from '../lib/api/auth.api'
import { useLiveSignal } from './useLiveSignal'

/**
 * Notices, live, that this booking was handed to another driver.
 *
 * Re-assigning writes the booking row, which fires `live:bookings` with its id.
 * On that signal (or on returning to the foreground) the booking is re-read; the
 * server answers 404 to a driver who is no longer on its crew. Anything else — offline, a 5xx — is not
 * taken as a hand-over: the server still refuses this driver's writes, so being
 * wrong costs nothing but a missed early warning.
 */
export function useCrewWatch(
  bookingId: string,
  onHandedOver: () => void,
  { enabled = true }: { enabled?: boolean } = {},
): void {
  const fired = useRef(false)

  const check = useCallback(async (ids: Set<string>) => {
    if (fired.current) return
    if (ids.size > 0 && !ids.has(bookingId)) return
    try {
      await api.get(`/booking/${bookingId}`)
    } catch (e: any) {
      const status = e?.response?.status
      if (status === 403 || status === 404) {
        fired.current = true
        onHandedOver()
      }
    }
  }, [bookingId, onHandedOver])

  useLiveSignal('live:bookings', (ids) => { void check(ids) }, { enabled })
}
