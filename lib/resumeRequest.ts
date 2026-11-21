import NetInfo from '@react-native-community/netinfo'

import api from './api/auth.api'
import { isOnline } from './network'
import { enqueue, flush, queuedIds } from './offlineQueue'

/**
 * "Ready to continue": the driver tells the office a paused delivery can move
 * again (the road is open, the bay has opened). It never ends the pause: the
 * Operations Manager or the Company Administrator answers by ending it, or with
 * "Not yet" and a reason that arrives as a notification.
 *
 * Sent at once when there is signal; otherwise kept in the offline queue (one
 * per booking) and sent when signal returns, with the time it was pressed. The
 * server answers 200 even when the pause ended meanwhile, so a late one is
 * dropped quietly.
 */

export const resumeRequestQueueId = (bookingId: string) => `resume-request:${bookingId}`

export type ResumeRequestResult =
  | 'sent'
  | 'already_sent'
  | 'not_paused'
  | 'queued'
  | { refused: string }

export async function requestResume(bookingId: string, note: string): Promise<ResumeRequestResult> {
  const url  = `/driver/bookings/${bookingId}/resume-request`
  // The phone's own clock; the server corrects it by X-Device-Time.
  const body = { note: note.trim() || null, requested_at: new Date().toISOString() }

  const net = await NetInfo.fetch()
  if (isOnline(net)) {
    try {
      const { data } = await api.post(url, body)
      const state = data?.data?.state
      return state === 'already_sent' || state === 'not_paused' ? state : 'sent'
    } catch (e: any) {
      const status: number | undefined = e?.response?.status
      if (status === 403 || status === 404) {
        return { refused: e?.response?.data?.message ?? 'The office could not be asked from this phone. Call them.' }
      }
      // No answer (dead zone despite the radio, timeout, 5xx): queue it below.
    }
  }

  await enqueue({ id: resumeRequestQueueId(bookingId), kind: 'resume_request', method: 'post', url, body })
  void flush()
  return 'queued'
}

/** A "Ready to continue" for this booking is still on the phone, waiting for signal. */
export async function resumeRequestQueued(bookingId: string): Promise<boolean> {
  return (await queuedIds()).includes(resumeRequestQueueId(bookingId))
}
