import React, { useState } from 'react'

import { ConfirmDialog } from '../ui/ConfirmDialog'
import { EmergencyCallModal } from './EmergencyCallModal'
import { sendQuickAlert } from '../../lib/quickAlert'
import { callEmergencyContact } from '../../lib/emergencyCall'
import { dataGoodForVoice, loadVoiceKit } from '../../lib/voiceCall'
import type { EmergencyContact } from '../../lib/api/reports.api'

/**
 * "SEND QUICK ALERT?" — the one question between QUICK ALERT and the alert.
 *
 * Yes does two things, in this order:
 *  1. Sends the alert (position, speed, truck). It goes first and on its own,
 *     so Operations has the driver's location on screen the moment they pick up.
 *  2. Calls Operations. In the app (LiveKit) when the connection is good,
 *     ringing every Operations Manager's browser at once. Otherwise, or if that
 *     call can't connect or nobody answers, through the phone's own dialer on
 *     mobile signal, using the number the server gave (or the cached one).
 *
 * No closes it and nothing is sent.
 *
 * Shared by the SOS button on the map and the reports list's floating button,
 * so both paths ask the same question and make the same call.
 */

interface Props {
  visible:    boolean
  bookingId?: string | null
  onClose:    () => void
  /** Called with the new report's id once the alert is away. */
  onSent?:    (reportId: string) => void
}

export function QuickAlertConfirm({ visible, bookingId, onClose, onSent }: Props) {
  const [busy, setBusy] = useState(false)
  const [voice, setVoice] = useState<{ reportId: string; contact: EmergencyContact | null } | null>(null)

  const confirm = async () => {
    setBusy(true)
    try {
      const { reportId, callContact } = await sendQuickAlert({ bookingId })
      onClose()
      if (reportId) onSent?.(reportId)

      // The in-app call needs the alert on record (it rings with its details)
      // and a connection that can carry voice. Without either, go to the phone.
      const inApp = !!reportId && !!loadVoiceKit() && (await dataGoodForVoice())
      if (inApp) {
        setVoice({ reportId: reportId!, contact: callContact })
      } else {
        await callEmergencyContact(callContact, { alertSent: !!reportId })
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <ConfirmDialog
        visible={visible}
        tone="red"
        title="Send quick alert?"
        message="Operations will get an emergency alert with your location, then your phone will call the Operations Manager on duty."
        confirmLabel="Yes"
        cancelLabel="No"
        busy={busy}
        onConfirm={() => { void confirm() }}
        onCancel={() => { if (!busy) onClose() }}
      />

      {voice && (
        <EmergencyCallModal
          reportId={voice.reportId}
          onDone={() => setVoice(null)}
          onFallback={() => { void callEmergencyContact(voice.contact, { alertSent: true }) }}
        />
      )}
    </>
  )
}
