import React, { useCallback, useEffect, useState } from 'react'
import {
  ActivityIndicator,
  Image,
  Linking,
  Modal,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native'
import { Camera, CheckCircle2, MapPin, RefreshCw, X } from 'lucide-react-native'

import { captureProofPhoto, CameraPermissionError } from '../../../lib/proofPhoto'
import { checkStopProximity, type Coordinates, type ProximityCheck } from '../../../lib/stopGeofence'
import type { StopProofContext } from '../../../lib/tripProgress'
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
 *
 * It is also where the driver has to actually BE at the stop. The photo proves
 * the load; the position proves the place. The check runs here rather than on
 * the server's reply because a confirmation may sit in the offline queue for
 * hours — by then the driver is long gone, and the queue discards a refusal
 * without telling anyone. Asking now is the only moment the driver can walk
 * fifty metres and fix it.
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
  /** The stop's own coordinates. Null/absent means it can't be measured. */
  stopCoordinates?: Coordinates | null
  onConfirm: (photoUri: string, proof: StopProofContext) => void
  onCancel:  () => void
}

export function StopProofModal({
  visible, title, address, kind, autoOpened, stopCoordinates, onConfirm, onCancel,
}: Props) {
  const [photoUri, setPhotoUri] = useState<string | null>(null)
  const [busy, setBusy]         = useState(false)
  const [error, setError]       = useState<string | null>(null)
  const [permissionBlocked, setPermissionBlocked] = useState(false)

  const [proximity, setProximity] = useState<ProximityCheck | null>(null)
  const [locating, setLocating]   = useState(false)
  const [reason, setReason]       = useState('')

  const stopLabel = kind === 'pickup' ? 'pickup point' : 'drop-off'

  // Each opening is a fresh stop — never carry a photo, or a previous stop's
  // position, across.
  useEffect(() => {
    if (visible) {
      setPhotoUri(null)
      setError(null)
      setPermissionBlocked(false)
      setBusy(false)
      setProximity(null)
      setReason('')
    }
  }, [visible])

  // Depend on the numbers, never on the object holding them. The caller builds
  // `stopCoordinates` fresh on every render, so using it as a dependency gave
  // `measure` a new identity each time, which re-ran the effect, which set state,
  // which rendered again — the position read looping forever and tearing the
  // reason box out from under the driver every time it did.
  const stopLat = stopCoordinates?.latitude ?? null
  const stopLon = stopCoordinates?.longitude ?? null

  /**
   * Read the position when the popup opens, not when Confirm is pressed: the
   * driver should see how far off they are while there is still time to move,
   * rather than being refused after taking the photo.
   */
  const measure = useCallback(async () => {
    setLocating(true)
    try {
      const stop = stopLat != null && stopLon != null
        ? { latitude: stopLat, longitude: stopLon }
        : null
      setProximity(await checkStopProximity(stop, stopLabel))
    } finally {
      setLocating(false)
    }
  }, [stopLat, stopLon, stopLabel])

  useEffect(() => { if (visible) void measure() }, [visible, measure])

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

  // Out of range (or no fix) and the driver has written a reason: they are
  // forcing this one through, and the button says so.
  const overriding = proximity != null && !proximity.withinRadius && reason.trim().length >= 3
  // Only the very first read blanks the panel; a re-check refreshes in place so
  // the driver keeps whatever they were part-way through typing.
  const measuring  = locating && proximity == null
  // Confirm needs an answer about where they are — but any answer will do, as
  // long as it is either close enough or accompanied by a reason.
  const canConfirm = !!photoUri && proximity != null && (proximity.withinRadius || overriding)

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

          {/* Where the driver is. Shown before the actions because it can send
              them walking, which is the whole point of checking early. */}
          {measuring && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <ActivityIndicator size="small" color={C.cyan} />
              <Text style={{ color: C.dimmer, fontSize: 12.5 }}>Checking you&apos;re at the {stopLabel}…</Text>
            </View>
          )}

          {proximity?.withinRadius && proximity.distanceM != null && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <MapPin size={15} color={C.green} />
              <Text style={{ color: C.green, fontSize: 12.5, fontWeight: '700' }}>
                At the {stopLabel} · {proximity.distanceM} m away
              </Text>
            </View>
          )}

          {proximity && !proximity.withinRadius && (
            <View style={{ gap: 8, padding: 12, borderRadius: 12, backgroundColor: C.surfaceHi, borderWidth: 1, borderColor: C.border }}>
              <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}>
                <MapPin size={15} color={C.red} style={{ marginTop: 2 }} />
                <Text style={{ color: C.red, fontSize: 12.5, lineHeight: 18, flex: 1 }}>
                  {proximity.message}
                </Text>
              </View>

              <TouchableOpacity
                onPress={() => { if (!locating) void measure() }}
                disabled={locating}
                style={{ alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6 }}
              >
                {locating && <ActivityIndicator size="small" color={C.cyan} />}
                <Text style={{ color: C.cyan, fontSize: 13, fontWeight: '700', opacity: locating ? 0.6 : 1 }}>
                  {locating ? 'Checking…' : 'Check again'}
                </Text>
              </TouchableOpacity>

              {/* The way past, and deliberately a little effortful: it is
                  recorded against the stop and reviewed by operations. */}
              <TextInput
                value={reason}
                onChangeText={setReason}
                placeholder="Why confirm from here? (required to override)"
                placeholderTextColor={C.dimmer}
                multiline
                style={{
                  color: C.white, fontSize: 13, minHeight: 44, paddingHorizontal: 10,
                  paddingVertical: 8, borderRadius: 10, backgroundColor: C.surface,
                  borderWidth: 1, borderColor: C.border, textAlignVertical: 'top',
                }}
              />
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
              onPress={() => {
                if (!canConfirm || !photoUri) return
                onConfirm(photoUri, {
                  fix: proximity?.fix ?? null,
                  overrideReason: overriding ? reason.trim() : null,
                })
              }}
              disabled={!canConfirm}
              style={{
                flex: 1.3, paddingVertical: 14, borderRadius: 14,
                flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
                backgroundColor: !canConfirm ? C.surfaceHi : overriding ? C.orange : C.green,
                borderWidth: 1, borderColor: !canConfirm ? C.border : overriding ? C.orange : C.green,
                opacity: canConfirm ? 1 : 0.55,
              }}
            >
              <CheckCircle2 size={17} color={canConfirm ? '#000' : C.dimmer} />
              <Text style={{ color: canConfirm ? '#000' : C.dimmer, fontSize: 14, fontWeight: '800' }}>
                {overriding ? 'Confirm anyway' : 'Yes, done'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  )
}
