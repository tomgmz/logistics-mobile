import { Platform } from 'react-native'
import * as Passkeys from 'react-native-passkeys'

/**
 * Passkey support, behind one door.
 *
 * Everything the app knows about the passkey library lives in this file. That is
 * on purpose: react-native-passkeys is still pre-1.0, and if it has to be
 * swapped for another binding the change should be one file rather than a
 * rewrite of the enrolment screen and the sign-in screen.
 *
 * It also keeps the platform-capability rule in one place, which matters because
 * getting it wrong is invisible until a driver is standing next to a truck.
 */

/**
 * The Android version that can actually hold a passkey.
 *
 * Credential Manager serves passwords and Sign-in-with-Google much further back,
 * but public-key credentials need Android 9. The app's own minSdk is 24, so a
 * driver CAN install this on Android 7 or 8 and find that enrolment is simply
 * not possible — which is why this is checked up front and said plainly rather
 * than discovered at the biometric prompt.
 */
const MIN_ANDROID_API = 28

export type PasskeySupport =
  | { supported: true }
  | { supported: false; reason: 'os-too-old' | 'unavailable' | 'wrong-platform'; message: string }

/**
 * Can this device enrol and use a passkey?
 *
 * Two separate questions, and both have to be asked. The OS version says whether
 * Credential Manager has passkey support at all; isSupported() says whether this
 * build can reach it. A device can pass the first and fail the second — a
 * cut-down Android without Google Play services, for instance.
 */
export function checkPasskeySupport(): PasskeySupport {
  if (Platform.OS !== 'android' && Platform.OS !== 'ios') {
    return {
      supported: false,
      reason:    'wrong-platform',
      message:   'Passkeys are only available in the mobile app.',
    }
  }

  if (Platform.OS === 'android') {
    const api = typeof Platform.Version === 'number'
      ? Platform.Version
      : parseInt(String(Platform.Version), 10)

    if (!Number.isNaN(api) && api < MIN_ANDROID_API) {
      return {
        supported: false,
        reason:    'os-too-old',
        message:
          'This phone runs a version of Android that cannot store a passkey ' +
          '(Android 9 or newer is required). Ask your dispatcher to assign a company driver.',
      }
    }
  }

  try {
    if (!Passkeys.isSupported()) {
      return {
        supported: false,
        reason:    'unavailable',
        message:
          'This phone cannot set up a passkey. Check that a screen lock (fingerprint, face, ' +
          'or PIN) is enabled, then try again.',
      }
    }
  } catch {
    return {
      supported: false,
      reason:    'unavailable',
      message:   'This phone cannot set up a passkey. Ask your dispatcher to assign a company driver.',
    }
  }

  return { supported: true }
}

/** Raised when the driver dismissed the OS prompt. Not an error worth a red banner. */
export class PasskeyCancelled extends Error {
  constructor() {
    super('Passkey prompt dismissed')
    this.name = 'PasskeyCancelled'
  }
}

/**
 * A dismissed prompt and a real failure arrive the same way from the platform,
 * so they are told apart here rather than at each call site. WebAuthn collapses
 * "the user said no", "there was no matching credential" and several genuine
 * errors into NotAllowedError precisely so a site cannot tell them apart — which
 * is good for the driver's privacy and mildly annoying here.
 */
function isCancellation(err: unknown): boolean {
  const name    = (err as any)?.name ?? ''
  const message = String((err as any)?.message ?? '')
  return (
    name === 'NotAllowedError' ||
    name === 'UserCancelled' ||
    /cancel|abort|not allowed|dismiss/i.test(message)
  )
}

/**
 * Create a passkey. `options` is the JSON the server produced with
 * generateRegistrationOptions and is passed through untouched — re-shaping it
 * here would mean keeping a second copy of the WebAuthn spec in the app.
 */
export async function createPasskey(options: any): Promise<any> {
  try {
    // TEMP DIAGNOSTIC — remove after debugging RP ID validation
    console.log('PASSKEY_DEBUG options =', JSON.stringify(options))
    const result = await Passkeys.create(options)
    if (!result) throw new PasskeyCancelled()
    return result
  } catch (err) {
    // TEMP DIAGNOSTIC — remove after debugging RP ID validation
    console.log('PASSKEY_DEBUG error name =', (err as any)?.name,
                '| code =', (err as any)?.code,
                '| message =', (err as any)?.message)
    if (err instanceof PasskeyCancelled) throw err
    if (isCancellation(err)) throw new PasskeyCancelled()
    throw err
  }
}

/** Assert an existing passkey. The OS shows the account picker; no email is typed. */
export async function getPasskey(options: any): Promise<any> {
  try {
    const result = await Passkeys.get(options)
    if (!result) throw new PasskeyCancelled()
    return result
  } catch (err) {
    if (err instanceof PasskeyCancelled) throw err
    if (isCancellation(err)) throw new PasskeyCancelled()
    throw err
  }
}

/** A human label for the credential, so an admin's passkey list is readable. */
export function deviceLabel(): string {
  return `${Platform.OS === 'ios' ? 'iPhone' : 'Android'} ${Platform.Version}`
}
