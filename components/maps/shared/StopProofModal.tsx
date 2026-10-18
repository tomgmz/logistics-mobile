import React, { useCallback, useEffect, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Image,
  Linking,
  Modal,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native'
import { Camera, CheckCircle2, MapPin, Minus, Plus, RefreshCw, X } from 'lucide-react-native'

import { captureProofPhoto, CameraPermissionError } from '../../../lib/proofPhoto'
import { checkStopProximity, type Coordinates, type ProximityCheck } from '../../../lib/stopGeofence'
import type { StopProofContext } from '../../../lib/tripProgress'
import { itemLine, type StopManifest } from '../../../lib/cargoManifest'
import { C } from '../../../theme/navigation.theme'
import { useKeyboardHeight } from '../../../hooks/useKeyboardHeight'

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

/** One cargo line the driver loads at a pickup: the plan, and the most there is left. */
export interface LoadLine {
  item_id:   string
  label:     string
  /** e.g. "Drop-off 2" — which bay it goes to. */
  dropoff:   string
  unit:      string
  planned:   number
  max:       number
  /** False for a line with no quantity: it goes whole or not at all. */
  divisible: boolean
}

export type LoadedQuantities = Array<{ item_id: string; quantity: number }>

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
  /**
   * What is meant to come off at THIS stop.
   *
   * The driver is standing at the tailgate deciding whether the drop is done;
   * this is the moment the manifest is worth something. Until cargo recorded
   * which drop-off it belonged to there was nothing trustworthy to show here, so
   * nothing was shown. Absent or empty renders nothing, which is the right
   * behaviour for a pickup and for older bookings whose cargo names no stop.
   */
  manifest?: StopManifest | null
  /**
   * Pickup only: this trip's planned load, line by line. The driver can load
   * less (it goes on the next trip) or more (it comes off the later ones).
   */
  loadPlan?: LoadLine[] | null
  /** `loaded` is set only when the driver changed the plan. */
  onConfirm: (photoUri: string, proof: StopProofContext, loaded?: LoadedQuantities | null) => void
  onCancel:  () => void
}

export function StopProofModal({
  visible, title, address, kind, autoOpened, stopCoordinates, manifest, loadPlan, onConfirm, onCancel,
}: Props) {
  const [loads, setLoads] = useState<Record<string, number>>({})
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
      setLoads(Object.fromEntries((loadPlan ?? []).map((l) => [l.item_id, l.planned])))
    }
    // Only on opening: a re-render with a fresh loadPlan array must not undo
    // what the driver has already changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
  const plan       = isPickup ? loadPlan ?? [] : []
  const loadedSum  = plan.reduce((n, l) => n + (loads[l.item_id] ?? 0), 0)
  const changed    = plan.some((l) => Math.abs((loads[l.item_id] ?? 0) - l.planned) > 1e-9)
  const setLoad = (l: LoadLine, v: number) => {
    const clean = Math.min(l.max, Math.max(0, Number.isFinite(v) ? v : 0))
    setLoads((prev) => ({ ...prev, [l.item_id]: l.divisible ? clean : (clean >= 1 ? 1 : 0) }))
  }
  // A trip has to carry something; leaving everything is not a trip.
  const loadOk     = plan.length === 0 || loadedSum > 0
  const canConfirm = !!photoUri && proximity != null && (proximity.withinRadius || overriding) && loadOk

  // The override reason sits at the bottom, right above the buttons: keep both
  // above the keyboard (useKeyboardHeight), and let the card scroll on a short
  // screen with the photo, the manifest and the keyboard all showing.
  const keyboardH = useKeyboardHeight()
  const scrollRef = useRef<ScrollView>(null)
  useEffect(() => {
    if (keyboardH > 0) requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }))
  }, [keyboardH])

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.75)', paddingBottom: keyboardH }}>
      <ScrollView
        ref={scrollRef}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{
          flexGrow: 1, alignItems: 'center', justifyContent: 'center',
          paddingHorizontal: 22, paddingVertical: 24,
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

          {/* What should be coming off here. Shown above the photo prompt: the
              driver checks the load against this BEFORE deciding the stop is
              done, which is the whole point of putting it on this screen. */}
          {!isPickup && manifest && manifest.items.length > 0 && (
            <View
              style={{
                backgroundColor: C.surfaceHi,
                borderRadius: 12,
                borderWidth: 1, borderColor: C.border,
                paddingHorizontal: 12, paddingVertical: 10, gap: 6,
              }}
            >
              <Text style={{ color: C.dimWhite, fontSize: 11, fontWeight: '800', letterSpacing: 1 }}>
                FOR THIS STOP
              </Text>
              {manifest.items.map((item) => (
                <Text key={item.item_id} style={{ color: C.white, fontSize: 13, lineHeight: 19 }}>
                  {itemLine(item)}
                  {item.weight_kg != null ? (
                    <Text style={{ color: C.dimWhite }}>{`  ·  ${item.weight_kg} kg`}</Text>
                  ) : null}
                </Text>
              ))}
              {manifest.items.length > 1 && manifest.totalQty > 0 && (
                <Text style={{ color: C.dimWhite, fontSize: 12 }}>
                  {manifest.totalQty} items
                  {manifest.totalWeight > 0 ? ` · ${manifest.totalWeight} kg total` : ''}
                </Text>
              )}
            </View>
          )}

          {/* What goes on the truck this trip. Prefilled with the plan; whatever
              the driver leaves goes on the next trip automatically. */}
          {plan.length > 0 && (
            <View
              style={{
                backgroundColor: C.surfaceHi,
                borderRadius: 12,
                borderWidth: 1, borderColor: C.border,
                paddingHorizontal: 12, paddingVertical: 10, gap: 8,
              }}
            >
              <Text style={{ color: C.dimWhite, fontSize: 11, fontWeight: '800', letterSpacing: 1 }}>
                LOAD FOR THIS TRIP
              </Text>
              {plan.map((l) => {
                const v = loads[l.item_id] ?? 0
                const step = 1
                return (
                  <View key={l.item_id} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={{ color: C.white, fontSize: 13 }} numberOfLines={2}>{l.label}</Text>
                      <Text style={{ color: C.dimmer, fontSize: 11 }} numberOfLines={1}>
                        {l.dropoff} · planned {fmtQty(l.planned)} {l.unit}
                      </Text>
                    </View>
                    <TouchableOpacity
                      onPress={() => setLoad(l, v - step)}
                      disabled={v <= 0}
                      hitSlop={6}
                      accessibilityLabel={`Less ${l.label}`}
                      style={[qtyBtn, v <= 0 && { opacity: 0.35 }]}
                    >
                      <Minus size={14} color={C.white} />
                    </TouchableOpacity>
                    <TextInput
                      value={fmtQty(v)}
                      onChangeText={(t) => setLoad(l, t.trim() === '' ? 0 : Number(t.replace(',', '.')))}
                      keyboardType="decimal-pad"
                      editable={l.divisible}
                      selectTextOnFocus
                      accessibilityLabel={`${l.label} loaded`}
                      style={{
                        width: 56, height: 34, borderRadius: 8, textAlign: 'center',
                        color: C.white, fontSize: 14, fontWeight: '800',
                        backgroundColor: C.surface, borderWidth: 1, borderColor: C.border, paddingVertical: 0,
                      }}
                    />
                    <TouchableOpacity
                      onPress={() => setLoad(l, v + step)}
                      disabled={v >= l.max}
                      hitSlop={6}
                      accessibilityLabel={`More ${l.label}`}
                      style={[qtyBtn, v >= l.max && { opacity: 0.35 }]}
                    >
                      <Plus size={14} color={C.white} />
                    </TouchableOpacity>
                  </View>
                )
              })}
              <Text style={{ color: loadOk ? C.dimmer : C.red, fontSize: 11.5, lineHeight: 16 }}>
                {!loadOk
                  ? 'Load at least one item for this trip.'
                  : changed
                    ? 'Changed from the plan. Anything left goes on the next trip; extra comes off the later ones.'
                    : 'Change these if the truck can take more or less. Anything left goes on the next trip.'}
              </Text>
            </View>
          )}

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
                onConfirm(
                  photoUri,
                  { fix: proximity?.fix ?? null, overrideReason: overriding ? reason.trim() : null },
                  changed ? plan.map((l) => ({ item_id: l.item_id, quantity: loads[l.item_id] ?? 0 })) : null,
                )
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
      </ScrollView>
      </View>
    </Modal>
  )
}

const qtyBtn = {
  width: 34, height: 34, borderRadius: 8,
  alignItems: 'center' as const, justifyContent: 'center' as const,
  backgroundColor: C.surface, borderWidth: 1, borderColor: C.border,
}

const fmtQty = (n: number) => String(Math.round(n * 1000) / 1000)
