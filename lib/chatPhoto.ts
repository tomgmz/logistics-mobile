import * as ImagePicker from 'expo-image-picker'

import api from './api/auth.api'
import { readCurrentFix } from './stopGeofence'

/**
 * Photos sent in chat. Unlike proof photos these may come from the camera or
 * the gallery, and the sender chooses how it goes out:
 *   - 'stamp': the server burns in the same time-and-place stamp the proof
 *     photos carry (for a driver on a delivery, the plate and booking too);
 *   - 'plain': the photo as it is.
 * Either way the server strips the EXIF block, so the phone's hidden GPS tag
 * is never passed on.
 */

/** The largest photo that can be sent. */
export const MAX_CHAT_PHOTO_BYTES = 10 * 1024 * 1024

/** What the server stores as the caption of a photo sent without one. */
export const PHOTO_PLACEHOLDER = '📷 Photo'

export type ChatPhotoSource = 'camera' | 'library'
export type ChatPhotoMode   = 'stamp' | 'plain'

export interface PickedChatPhoto {
  uri:      string
  takenAt:  string          // ISO; for a gallery pick, when it was picked
  fileSize: number | null
}

export class ChatPhotoError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ChatPhotoError'
  }
}

/** Take or pick a photo; null when the user backs out. Throws ChatPhotoError on no access / too big. */
export async function pickChatPhoto(source: ChatPhotoSource): Promise<PickedChatPhoto | null> {
  const permission = source === 'camera'
    ? await ImagePicker.requestCameraPermissionsAsync()
    : await ImagePicker.requestMediaLibraryPermissionsAsync()
  if (!permission.granted) {
    throw new ChatPhotoError(source === 'camera'
      ? 'Camera access is needed to take a photo. Enable it in Settings, then try again.'
      : 'Photo access is needed to choose a photo. Enable it in Settings, then try again.')
  }

  const options: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 0.8, allowsEditing: false, exif: false }
  const result = source === 'camera'
    ? await ImagePicker.launchCameraAsync(options)
    : await ImagePicker.launchImageLibraryAsync(options)
  if (result.canceled || !result.assets?.length) return null

  const asset = result.assets[0]
  if (asset.fileSize != null && asset.fileSize > MAX_CHAT_PHOTO_BYTES) {
    throw new ChatPhotoError('Photos can be up to 10 MB. Choose a smaller one.')
  }
  return { uri: asset.uri, takenAt: new Date().toISOString(), fileSize: asset.fileSize ?? null }
}

/** Upload a picked photo and return its URL, to send as the message's attachment_url. */
export async function uploadChatPhoto(photo: PickedChatPhoto, mode: ChatPhotoMode): Promise<{ url: string; stamped: boolean }> {
  const form = new FormData()
  if (mode === 'stamp') {
    // Text fields before the file, so they are parsed before the image arrives.
    const fix = await readCurrentFix()
    form.append('stamp', '1')
    form.append('taken_at', photo.takenAt)
    if (fix) {
      form.append('latitude',  String(fix.latitude))
      form.append('longitude', String(fix.longitude))
      if (fix.accuracy_m != null) form.append('accuracy_m', String(fix.accuracy_m))
    }
  }
  // React Native's FormData takes this {uri, name, type} shape for files.
  form.append('image', { uri: photo.uri, name: fileNameFor(photo.uri), type: mimeTypeFor(photo.uri) } as any)

  try {
    const { data } = await api.post('/messaging/photos', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 60_000,
    })
    const url = data?.data?.url
    if (!url) throw new Error('Upload did not return a photo URL')
    return { url, stamped: !!data?.data?.stamped }
  } catch (err: any) {
    throw new ChatPhotoError(err?.response?.data?.message ?? 'The photo could not be sent. Check your connection and try again.')
  }
}

function fileNameFor(uri: string): string {
  const last = uri.split('/').pop()
  return last && last.includes('.') ? last : `photo-${Date.now()}.jpg`
}

function mimeTypeFor(uri: string): string {
  const ext = uri.split('.').pop()?.toLowerCase()
  if (ext === 'png')  return 'image/png'
  if (ext === 'heic') return 'image/heic'
  if (ext === 'webp') return 'image/webp'
  return 'image/jpeg'
}
