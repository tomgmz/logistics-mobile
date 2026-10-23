import { Alert, Linking } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'

import { getEmergencyContact, type EmergencyContact } from './api/reports.api'

/**
 * The phone call that follows a quick alert.
 *
 * An ordinary phone call through the dialer, not an in-app voice call: it is
 * free, needs no SDK, and runs on mobile signal alone. A driver in trouble at
 * the roadside often has signal but no data, which is exactly when an in-app
 * call would fail.
 *
 * That is also why the number is cached. The server picks the Operations
 * Manager on duty, or else the Company Administrator, and the app saves the
 * answer every time it hears one. If the alert itself can't get through, the
 * driver can still reach a person.
 */

const CACHE_KEY = 'emergency_contact_v1'

export async function cacheEmergencyContact(contact: EmergencyContact | null | undefined): Promise<void> {
  if (!contact?.phone) return
  try { await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(contact)) } catch {}
}

export async function cachedEmergencyContact(): Promise<EmergencyContact | null> {
  try {
    const raw = await AsyncStorage.getItem(CACHE_KEY)
    return raw ? (JSON.parse(raw) as EmergencyContact) : null
  } catch {
    return null
  }
}

/** Refresh the cached number in the background. Never throws. */
export async function prefetchEmergencyContact(): Promise<void> {
  try { await cacheEmergencyContact(await getEmergencyContact()) } catch {}
}

/**
 * Open the dialer on the given number, or on the cached one when none is given.
 * `alertSent` only changes what the driver is told if there is nobody to call.
 */
export async function callEmergencyContact(
  contact: EmergencyContact | null | undefined,
  { alertSent }: { alertSent: boolean },
): Promise<void> {
  const target = contact?.phone ? contact : await cachedEmergencyContact()
  const phone  = target?.phone?.replace(/[^\d+]/g, '')

  try {
    if (!phone) throw new Error('no number')
    await Linking.openURL(`tel:${phone}`)
  } catch {
    Alert.alert(
      'No number to call',
      alertSent
        ? 'Your alert was sent. Operations will contact you.'
        : 'There is no Operations number saved on this phone. Call your office directly.',
    )
  }
}
