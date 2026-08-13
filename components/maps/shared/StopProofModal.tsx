import React, { useCallback, useEffect, useState } from 'react'
import {
  ActivityIndicator,
  Image,
  Linking,
  Modal,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'
import { Camera, CheckCircle2, RefreshCw, X } from 'lucide-react-native'

import { captureProofPhoto, CameraPermissionError } from '../../../lib/proofPhoto'
import { C } from '../../../theme/navigation.theme'

/**
 * The stop confirmation popup: "is this actually done?", with the proof photo
 * the driver has to take before they can answer yes.
 *
 * It opens two ways — automatically when the navigation SDK detects arrival at
 * the stop, or from the confirm button when that detection doesn't fire. Both
 * land here, so a stop is never recorded without the driver looking at this and
 * photographing the load.
 *
 * The photo is handed back as a LOCAL file URI. Uploading is the caller's
 * business (see lib/tripProgress), which is what lets a stop be confirmed with
 * no signal.
 */

interface Props {
  visible: boolean
  /** e.g. "Pickup" or "Drop-off 2 of 3" */
  title:    string
  /** Street address of the stop, shown so the driver can sanity-check it. */
  address?: string
  kind:     'pickup' | 'dropoff'
  /** True when the SDK detected arrival, i.e. the popup opened by itself. */
  autoOpened?: boolean
  onConfirm: (photoUri: string) => void
  onCancel:  () => void
}

export function StopProofModal({
  visible, title, address, kind, autoOpened, onConfirm, onCancel,
}: Props) {
  const [photoUri, setPhotoUri] = useState<string | null>(null)
  const [busy, setBusy]         = useState(false)
  const [error, setError]       = useState<string | null>(null)
  const [permissionBlocked, setPermissionBlocked] = useState(false)

  // Each opening is a fresh stop — never carry a photo across.
  useEffect(() => {
    if (visible) {
      setPhotoUri(null)
      setError(null)
      setPermissionBlocked(false)
      setBusy(false)
    }
  }, [visible])

  const takePhoto = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      const uri = await captureProofPhoto()
      if (uri) setPhotoUri(uri)
    } catch (e: any) {
      if (e instanceof CameraPermissionError) {
        setPermissionBlocked(true)
        setError(e.message)
      } else {
        setError(e?.message ?? 'Could not open the camera. Try again.')
      }
    } finally {
      setBusy(false)
    }
  }, [])

  const isPickup   = kind === 'pickup'
  const proofLabel = isPickup ? 'proof of pickup' : 'proof of delivery'

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View
        style={{
          flex: 1, backgroundColor: 'rgba(0,0,0,0.75)',
          alignItems: 'center', justifyContent: 'center', paddingHorizontal: 22,
        }}
      >
        <View
          style={{
            width: '100%', maxWidth: 420,
            backgroundColor: C.surface, borderRadius: 20,
            borderWidth: 1, borderColor: C.border,
            paddingHorizontal: 20, paddingTop: 18, paddingBottom: 16, gap: 14,
          }}
        >
          {/* Header */}
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 12 }}>
            <View style={{ flex: 1, gap: 3 }}>
              <Text style={{ color: C.white, fontSize: 18, fontWeight: '900' }}>{title}</Text>
              {!!address && (
                <Text style={{ color: C.dimWhite, fontSize: 13, lineHeight: 19 }} numberOfLines={2}>
                  {address}
                </Text>
              )}
            </View>
            <TouchableOpacity onPress={onCancel} hitSlop={10} style={{ padding: 2 }}>
              <X size={20} color={C.dimWhite} />
            </TouchableOpacity>
          </View>

          {/* Why we're asking. Worded differently when the app opened this by
              itself, so an arrival prompt doesn't read like an accusation. */}
          <Text style={{ color: C.dimWhite, fontSize: 13, lineHeight: 20 }}>
            {autoOpened
              ? `You've arrived. Is the ${isPickup ? 'pickup' : 'drop-off'} actually done? Take a photo as ${proofLabel} to confirm.`
              : `Confirm the ${isPickup ? 'cargo is loaded' : 'drop-off is delivered'}. A photo is required as ${proofLabel}.`}
          </Text>

          {/* Photo slot: tap to shoot, tap again to retake. */}
          {photoUri ? (
            <View style={{ gap: 10 }}>
              <Image
                source={{ uri: photoUri }}
                style={{
                  width: '100%', height: 190, borderRadius: 14,
                  borderWidth: 1, borderColor: C.border, backgroundColor: C.surfaceHi,
                }}
                resizeMode="cover"
              />
              <TouchableOpacity
                onPress={takePhoto}
                disabled={busy}
                style={{
                  flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
                  paddingVertical: 10, borderRadius: 12,
                  backgroundColor: C.surfaceHi, borderWidth: 1, borderColor: C.border,
                }}
              >
                <RefreshCw size={15} color={C.cyan} />
                <Text style={{ color: C.cyan, fontSize: 13, fontWeight: '700' }}>Retake photo</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity
              onPress={takePhoto}
              disabled={busy}
              style={{
                height: 150, borderRadius: 14,
                alignItems: 'center', justifyContent: 'center', gap: 9,
                backgroundColor: C.surfaceHi,
                borderWidth: 1.5, borderColor: C.border, borderStyle: 'dashed',
              }}
            >
              {busy
                ? <ActivityIndicator color={C.cyan} />
                : <>
                    <Camera size={30} color={C.cyan} />
                    <Text style={{ color: C.white, fontSize: 14, fontWeight: '800' }}>Take {proofLabel}</Text>
                    <Text style={{ color: C.dimmer, fontSize: 12 }}>Required to confirm this stop</Text>
                  </>}
            </TouchableOpacity>
          )}

          {!!error && (
            <View style={{ gap: 8 }}>
              <Text style={{ color: C.red, fontSize: 12.5, lineHeight: 18 }}>{error}</Text>
              {permissionBlocked && (
                <TouchableOpacity onPress={() => Linking.openSettings()} style={{ alignSelf: 'flex-start' }}>
                  <Text style={{ color: C.cyan, fontSize: 13, fontWeight: '700' }}>Open settings</Text>
                </TouchableOpacity>
              )}
            </View>
          )}

          {/* Actions. Confirm stays locked until there's a photo. */}
          <View style={{ flexDirection: 'row', gap: 10, marginTop: 2 }}>
            <TouchableOpacity
              onPress={onCancel}
              style={{
                flex: 1, paddingVertical: 14, borderRadius: 14, alignItems: 'center',
                backgroundColor: C.surfaceHi, borderWidth: 1, borderColor: C.border,
              }}
            >
              <Text style={{ color: C.dimWhite, fontSize: 14, fontWeight: '700' }}>Not yet</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => photoUri && onConfirm(photoUri)}
              disabled={!photoUri}
              style={{
                flex: 1.3, paddingVertical: 14, borderRadius: 14,
                flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
                backgroundColor: photoUri ? C.green : C.surfaceHi,
                borderWidth: 1, borderColor: photoUri ? C.green : C.border,
                opacity: photoUri ? 1 : 0.55,
              }}
            >
              <CheckCircle2 size={17} color={photoUri ? '#000' : C.dimmer} />
              <Text style={{ color: photoUri ? '#000' : C.dimmer, fontSize: 14, fontWeight: '800' }}>
                Yes, done
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  )
}
