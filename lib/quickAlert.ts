import { Alert } from 'react-native'
import * as Location from 'expo-location'

import { createReport } from './api/reports.api'
import { readCurrentFix } from './stopGeofence'

/**
 * The SOS quick alert: raised the moment the driver asks for it.
 *
 * There is no countdown and no screen. The old flow opened a panel, ran twenty
 * seconds down and asked for a swipe, which buys a chance to cancel a false
 * alarm — but it also stands between a driver in trouble and the only thing they
 * need from this app. Tapping QUICK ALERT is now the whole interaction.
 *
 * Sending is deliberately NOT blocked on the position. Coordinates are the most
 * valuable thing the alert carries, so they are worth a moment's wait, but only
 * a moment: a fix that will not come must never be the reason an emergency goes
 * unreported. Past LOCATION_WAIT_MS the alert leaves without it, and operations
 * get an alert with a driver and a truck on it instead of nothing at all.
 *
 * The reverse-geocoded address is not waited for under any circumstances. It is
 * a courtesy for whoever reads the alert, and the coordinates already say where
 * the driver is.
 */

/** How long the alert will wait for a GPS fix before going without one. */
const LOCATION_WAIT_MS = 2_500

interface QuickAlertInput {
  bookingId?: string | null
}

/**
 * The fix if one arrives in time, null if it does not. Never rejects and never
 * outlives its deadline — the caller is an emergency path and cannot be left
 * waiting on the GPS stack.
 */
async function fixWithinDeadline() {
  return Promise.race([
    readCurrentFix().catch(() => null),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), LOCATION_WAIT_MS)),
  ])
}

/**
 * Raise the alert. Resolves with the new report's id, or null when it could not
 * be sent.
 *
 * Success is silent by design — the driver asked for one tap and got it. Failure
 * is NOT: an alert nobody received, that the driver believes is on its way, is
 * the worst outcome this module can produce, so that one case speaks up.
 */
export async function sendQuickAlert({ bookingId }: QuickAlertInput = {}): Promise<string | null> {
  const fix = await fixWithinDeadline()

  // Best-effort street address, and only from a fix we already have. Given its
  // own short deadline because the geocoder needs the network, which is exactly
  // what a driver in trouble may not have.
  let address: string | null = null
  if (fix) {
    address = await Promise.race([
      Location.reverseGeocodeAsync({ latitude: fix.latitude, longitude: fix.longitude })
        .then((places) => {
          const p = places?.[0]
          if (!p) return null
          return [p.name, p.street, p.city, p.region].filter(Boolean).join(', ') || null
        })
        .catch(() => null),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 1_500)),
    ])
  }

  try {
    const report = await createReport({
      source:        'quick',
      booking_id:    bookingId ?? null,
      // Nobody was asked what kind of emergency this is. An unspecified alert
      // that went out beats a categorised one that never did, and the driver can
      // fill it in from their reports list once they are safe.
      incident_type: null,
      latitude:      fix?.latitude ?? null,
      longitude:     fix?.longitude ?? null,
      accuracy_m:    fix?.accuracy_m ?? null,
      address,
    })
    return report.report_id
  } catch (e: any) {
    Alert.alert(
      'Alert not sent',
      e?.response?.data?.message ??
        'The emergency alert could not be sent — check your signal and tap SOS again.',
    )
    return null
  }
}
