import AsyncStorage from '@react-native-async-storage/async-storage'

/**
 * The driver's mute choice for navigation voice, kept per phone so it survives
 * leaving the nav screen, a restart and the next booking.
 *
 * Only the voice. The route, the map, live tracking and the notification keep
 * running while muted; this is the "quick break" control, not a stop.
 */
const KEY = 'nav.voiceMuted'

export async function loadNavMuted(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(KEY)) === '1'
  } catch {
    return false
  }
}

export function saveNavMuted(muted: boolean): void {
  AsyncStorage.setItem(KEY, muted ? '1' : '0').catch(() => {})
}
