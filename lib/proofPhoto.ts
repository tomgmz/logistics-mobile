import * as ImagePicker from 'expo-image-picker'

import api from './api/auth.api'

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
  return result.assets[0].uri
}

/**
 * Upload a captured photo and return its hosted URL. Rejects on network failure
 * so callers (and the offline queue) can retry with the same local file.
 */
export async function uploadProofPhoto(localUri: string): Promise<string> {
  const form = new FormData()
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
