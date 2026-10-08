import * as ImagePicker from 'expo-image-picker'

import api from './api/auth.api'
import type { StopFix } from './stopGeofence'

/**
 * Proof-of-pickup / proof-of-delivery photos.
 *
 * The driver photographs every stop before it can be confirmed. The photo is
 * taken with the CAMERA only — never picked from the gallery — so the proof is
 * something shot at the stop rather than a file chosen afterwards.
 *
 * Uploading is separate from taking: at a stop with no signal the photo is kept
 * as a local file URI and uploaded by the offline queue on reconnect (see
 * offlineQueue.flush), which is why `uploadProofPhoto` takes a URI rather than
 * the capture doing its own upload.
 */

// Proof photos are evidence, not portfolio pieces: quality 0.6 at a capped size
// keeps them readable while staying small enough to upload over a weak signal.
const QUALITY = 0.6

/**
 * What the server needs to burn the time-and-place stamp into a proof photo:
 * which stop it is, when the shutter fired, and where the phone was. Plate,
 * booking number, driver and street address are looked up server-side.
 *
 * Plain JSON on purpose — it is persisted with the offline queue entry, so a
 * photo uploaded hours later still carries the moment and place it was taken.
 */
export interface ProofStamp {
  stop:        'trip_pickup' | 'trip_stop'
  refId:       string            // trip_id for a pickup, trip_stop_id for a drop-off
  takenAt:     string            // ISO
  fix?:        StopFix | null
  addedLater?: boolean           // photo attached to a stop already confirmed
}

// When each captured file was shot, keyed by its URI. The capture happens a few
// seconds to a minute before the stop is confirmed, and the stamp should say
// when the picture was taken rather than when the button was pressed.
const takenAtByUri = new Map<string, string>()

/** When the photo at `uri` was taken, or now if this session never saw it captured. */
export function photoTakenAt(uri: string): string {
  return takenAtByUri.get(uri) ?? new Date().toISOString()
}

export class CameraPermissionError extends Error {
  constructor() {
    super('Camera access is needed to take the proof photo. Enable it in Settings, then try again.')
    this.name = 'CameraPermissionError'
  }
}

/**
 * Open the camera and return the local URI of the captured photo, or null if
 * the driver backed out. Throws CameraPermissionError when access is denied.
 */
export async function captureProofPhoto(): Promise<string | null> {
  const permission = await ImagePicker.requestCameraPermissionsAsync()
  if (!permission.granted) throw new CameraPermissionError()

  const result = await ImagePicker.launchCameraAsync({
    mediaTypes:    ['images'],
    quality:       QUALITY,
    allowsEditing: false,
    exif:          false,
  })

  if (result.canceled || !result.assets?.length) return null
  const uri = result.assets[0].uri
  takenAtByUri.set(uri, new Date().toISOString())
  return uri
}

/**
 * Upload a captured photo and return its hosted URL. Rejects on network failure
 * so callers (and the offline queue) can retry with the same local file.
 *
 * With a `stamp`, the server burns the time / place / plate overlay into the
 * stored photo. Without one (the report form) the photo is stored as taken.
 */
export async function uploadProofPhoto(localUri: string, stamp?: ProofStamp | null): Promise<string> {
  const form = new FormData()
  if (stamp) {
    // Text fields before the file, so they are parsed before the image arrives.
    form.append('stamp_stop', stamp.stop)
    form.append('stamp_ref',  stamp.refId)
    form.append('taken_at',   stamp.takenAt)
    if (stamp.fix) {
      form.append('latitude',  String(stamp.fix.latitude))
      form.append('longitude', String(stamp.fix.longitude))
      if (stamp.fix.accuracy_m != null) form.append('accuracy_m', String(stamp.fix.accuracy_m))
    }
    if (stamp.addedLater) form.append('added_later', '1')
  }
  // React Native's FormData takes this {uri, name, type} shape for files.
  form.append('image', {
    uri:  localUri,
    name: fileNameFor(localUri),
    type: mimeTypeFor(localUri),
  } as any)

  const { data } = await api.post('/driver/proof-photo', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
    // Photos are far heavier than the JSON calls the default timeout is sized
    // for, and drivers are often on a weak mobile signal.
    timeout: 60_000,
  })

  const url = data?.data?.url
  if (!url) throw new Error('Upload did not return a photo URL')
  return url
}

function fileNameFor(uri: string): string {
  const last = uri.split('/').pop()
  return last && last.includes('.') ? last : `proof-${Date.now()}.jpg`
}

function mimeTypeFor(uri: string): string {
  const ext = uri.split('.').pop()?.toLowerCase()
  if (ext === 'png')  return 'image/png'
  if (ext === 'heic') return 'image/heic'
  if (ext === 'webp') return 'image/webp'
  return 'image/jpeg'
}
