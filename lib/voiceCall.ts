import { PermissionsAndroid, Platform } from 'react-native'
import NetInfo from '@react-native-community/netinfo'

import api from './api/auth.api'
import { isOnline } from './network'

/**
 * The in-app emergency voice call (LiveKit) that follows a quick alert.
 *
 * Everything here is allowed to fail, because the fallback is an ordinary phone
 * call through the dialer (lib/emergencyCall.ts). The in-app call is tried only
 * when it has a fair chance:
 *
 *  - the app binary includes the native WebRTC module. An over-the-air update
 *    can reach a build made before LiveKit was added, and importing it there
 *    would crash, so the modules are loaded lazily inside a try;
 *  - the connection is good enough: our server is reachable and the phone is
 *    not on 2G, where voice over data breaks up;
 *  - the microphone is allowed.
 */

type LiveKitClient = typeof import('livekit-client')
type LiveKitRN     = typeof import('@livekit/react-native')

export interface VoiceKit {
  Room:         LiveKitClient['Room']
  RoomEvent:    LiveKitClient['RoomEvent']
  AudioSession: LiveKitRN['AudioSession']
  AndroidAudioTypePresets: LiveKitRN['AndroidAudioTypePresets']
}

let kit: VoiceKit | null | undefined

/** LiveKit, or null when this build has no native WebRTC. Loaded once. */
export function loadVoiceKit(): VoiceKit | null {
  if (kit !== undefined) return kit
  try {
    const rn: LiveKitRN = require('@livekit/react-native')
    rn.registerGlobals()
    const client: LiveKitClient = require('livekit-client')
    kit = {
      Room:         client.Room,
      RoomEvent:    client.RoomEvent,
      AudioSession: rn.AudioSession,
      AndroidAudioTypePresets: rn.AndroidAudioTypePresets,
    }
  } catch {
    kit = null
  }
  return kit
}

/** Good enough for voice over data? When unsure, yes — the call has its own timeouts. */
export async function dataGoodForVoice(): Promise<boolean> {
  try {
    const state = await NetInfo.fetch()
    if (!isOnline(state)) return false
    if (state.type === 'cellular' && state.details?.cellularGeneration === '2g') return false
    return true
  } catch {
    return true
  }
}

export async function microphoneAllowed(): Promise<boolean> {
  if (Platform.OS !== 'android') return true // iOS asks on first use of the mic
  try {
    const result = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO, {
      title:          'Microphone',
      message:        'Allow the microphone so you can talk to Operations during an emergency call.',
      buttonPositive: 'Allow',
    })
    return result === PermissionsAndroid.RESULTS.GRANTED
  } catch {
    return false
  }
}

/* ── Server ───────────────────────────────────────────────────────────────── */

export interface StartedCall {
  call_id:      string
  url:          string
  token:        string
  ring_seconds: number
}

/** Ring the desk. Short timeout: a slow answer here means the phone call is the better bet. */
export async function startEmergencyCall(reportId: string): Promise<StartedCall> {
  const { data } = await api.post('/driver/emergency-calls', { report_id: reportId }, { timeout: 8_000 })
  return data.data
}

export type CallEndReason = 'hangup' | 'no_answer' | 'failed' | 'fell_back'

/**
 * Tell the desk the call is over so their ringers stop. Best effort.
 * `detail` is the error behind a 'failed' call, for the IT Admin dashboard.
 */
export async function endEmergencyCall(callId: string, reason: CallEndReason, detail?: string): Promise<void> {
  try {
    await api.post(
      `/driver/emergency-calls/${callId}/end`,
      { reason, ...(detail ? { detail: detail.slice(0, 500) } : {}) },
      { timeout: 8_000 },
    )
  } catch {}
}
