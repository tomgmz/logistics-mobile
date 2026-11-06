/**
 * Sounds the app plays itself (as opposed to a push's sound, which the phone
 * plays from the notification channel).
 *
 * Today that is the ringback a driver hears while the SOS call rings the
 * Operations Manager, so they know the call is going through and not stuck.
 *
 * expo-audio is a native module added 2026-11-06, so it is required lazily: an
 * OTA update landing on an older build (without the module) gets silence rather
 * than a crash at the most stressful moment of a driver's day.
 */

type Player = {
  loop: boolean
  volume: number
  play: () => void
  pause: () => void
  remove: () => void
}

type AudioModule = {
  createAudioPlayer: (source: unknown) => Player
  setAudioModeAsync?: (mode: Record<string, unknown>) => Promise<void>
}

let cached: AudioModule | null | undefined

function audio(): AudioModule | null {
  if (cached !== undefined) return cached
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    cached = require('expo-audio') as AudioModule
  } catch {
    cached = null
  }
  return cached
}

let ringPlayer: Player | null = null

/** Start the looping ringback. Safe to call twice; silent if the build has no audio module. */
export async function startRingback(): Promise<void> {
  if (ringPlayer) return
  const mod = audio()
  if (!mod) return
  try {
    // Ring even with the phone on silent: the driver has just raised an emergency.
    await mod.setAudioModeAsync?.({ playsInSilentMode: true, interruptionMode: 'mixWithOthers' })
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const player = mod.createAudioPlayer(require('../assets/sounds/ringback.wav'))
    player.loop   = true
    player.volume = 0.9
    player.play()
    ringPlayer = player
  } catch (err) {
    console.warn('[sounds] ringback failed', err)
  }
}

/** Stop the ringback (answered, cancelled, handed to a phone call). Safe to call any time. */
export function stopRingback(): void {
  const player = ringPlayer
  ringPlayer = null
  if (!player) return
  try { player.pause() } catch { /* already gone */ }
  try { player.remove() } catch { /* already gone */ }
}
