import { Alert, Platform } from 'react-native'
import * as Device from 'expo-device'
import AsyncStorage from '@react-native-async-storage/async-storage'

/**
 * Warns once per phone when it probably can't run the driver app properly.
 * Navigation, maps, push and passkeys all need Google Play Services (Android)
 * and Google's navigation needs Android 9 (API 28) / iOS 16.
 *
 * JS only (no native module, so it ships over the air): there's no reliable
 * Google Play check without one, so Huawei phones get a "check for the Play
 * Store" warning instead of a verdict. A warning only; the app still works.
 */
const SEEN_KEY = 'device_support_warned_v1'

export function deviceSupportProblem(): { title: string; message: string } | null {
  if (!Device.isDevice) return null
  if (Platform.OS === 'android') {
    const api = Device.platformApiLevel ?? 99
    if (api < 28) {
      return {
        title: 'This phone is too old',
        message: `This phone runs Android ${Device.osVersion ?? ''}. Navigation needs Android 9 or newer, so it may not start or may stop during a delivery. Please ask the office for a supported phone.`,
      }
    }
    const maker = `${Device.manufacturer ?? ''} ${Device.brand ?? ''}`
    if (/huawei/i.test(maker)) {
      return {
        title: 'Check for the Play Store',
        message: 'Many Huawei phones come without Google Play. Without it, navigation, maps, notifications and passkey sign-in won\'t work. If this phone has no Play Store app, please ask the office for a supported phone.',
      }
    }
  }
  if (Platform.OS === 'ios') {
    const major = parseInt(String(Device.osVersion ?? '99').split('.')[0], 10)
    if (major < 16) {
      return {
        title: 'Please update this iPhone',
        message: `This iPhone runs iOS ${Device.osVersion}. Navigation needs iOS 16 or newer. Update it in Settings → General → Software Update, or ask the office for a supported phone.`,
      }
    }
  }
  return null
}

export async function warnIfUnsupportedDevice(): Promise<void> {
  try {
    const problem = deviceSupportProblem()
    if (!problem) return
    if (await AsyncStorage.getItem(SEEN_KEY)) return
    Alert.alert(problem.title, problem.message, [
      { text: 'OK', onPress: () => { AsyncStorage.setItem(SEEN_KEY, '1').catch(() => {}) } },
    ])
  } catch {
    // Never block the app over a warning.
  }
}
