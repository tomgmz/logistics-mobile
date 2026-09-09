import React, { useCallback, useState } from 'react'
import {
  ActivityIndicator,
  Image,
  ScrollView,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native'
import * as ImagePicker from 'expo-image-picker'
import { Check, Image as ImageIcon, SendHorizontal, Video, X } from 'lucide-react-native'

import { FONTS } from '../../lib/config/fonts'
import { uploadProofPhoto } from '../../lib/proofPhoto'
import {
  SUB_TYPES,
  type BlowbagetsItems,
  type CreateReportInput,
  type IncidentType,
} from '../../lib/api/reports.api'
import { IncidentTypeGrid } from './IncidentTypeGrid'
import { ReportDetailsPanel } from './ReportDetailsPanel'
import { useReportContext } from '../../hooks/useReportContext'

/**
 * The detailed emergency report.
 *
 * Everything on it exists to answer one operational question — does somebody
 * have to be sent out right now — and the form is ordered so that question is
 * reachable without scrolling past anything optional. Type, sub-type and
 * description are required; media and the vehicle check are not.
 *
 * The BLOWBAGETS section appears only for a vehicle breakdown, and only when the
 * driver opts in. It is the same ten-item mnemonic the fleet manager runs before
 * dispatch, taken again at the roadside — but it means something different here.
 * The yard inspection is a pass/fail certification of a whole vehicle; this is a
 * driver ticking off what they managed to look at beside a highway. So it starts
 * with NOTHING ticked, and a tick records that the item was checked rather than
 * that it passed. Whatever is actually wrong goes in the description, which is
 * the only field that can carry it.
 *
 * Built from the Figma report-info frames (2984:131, 2984:262, 2985:434).
 */

const D = {
  bg:     '#000000',
  card:   '#0e1010',
  inner:  '#1b1b1b',
  line:   '#424242',
  white:  '#ffffff',
  faint:  '#818181',
  cyan:   '#4df9ed',
  cyanDim:'rgba(77,249,237,0.19)',
  green:  '#3af626',
  greenDim:'rgba(58,246,38,0.19)',
  red:    '#f62626',
  redDim: 'rgba(246,38,38,0.19)',
}

/** The ten items, in mnemonic order. Battery and Brakes share a letter; the keys don't. */
const BLOWBAGETS: Array<{ key: keyof BlowbagetsItems; label: string; hint: string }> = [
  { key: 'battery', label: 'Battery', hint: 'Terminals clean, charge holding'   },
  { key: 'lights',  label: 'Lights',  hint: 'Head, tail, signal & hazard working' },
  { key: 'oil',     label: 'Oil',     hint: 'Engine oil at proper level'        },
  { key: 'water',   label: 'Water',   hint: 'Radiator coolant topped up'        },
  { key: 'brakes',  label: 'Brakes',  hint: 'Pedal firm, no leaks'              },
  { key: 'air',     label: 'Air',     hint: 'Tyre pressure within range'        },
  { key: 'gas',     label: 'Gas',     hint: 'Fuel sufficient for the route'     },
  { key: 'engine',  label: 'Engine',  hint: 'Starts clean, no warning lights'   },
  { key: 'tires',   label: 'Tires',   hint: 'Tread & sidewalls sound, spare present' },
  { key: 'self',    label: 'Self',    hint: 'Driver fit, rested & licensed'     },
]

/**
 * Nothing ticked to begin with.
 *
 * The driver ticks what they actually looked at, so an empty list is the honest
 * starting point. Starting all-ticked would mean a driver who opened the section
 * and scrolled past it silently certifies ten items they never checked — the
 * exact thing a vehicle inspection exists to prevent.
 */
const NONE_CHECKED: BlowbagetsItems = {
  battery: false, lights: false, oil: false, water: false, brakes: false,
  air: false, gas: false, engine: false, tires: false, self: false,
}

/**
 * What to write in the description, by incident type.
 *
 * A generic "describe the incident" gets generic answers — "accident", "engine
 * problem" — and the person reading it still has to phone the driver to learn
 * anything. A worked example shows the level of detail wanted without demanding
 * a form full of fields, which is not something to inflict on someone standing
 * on a hard shoulder.
 */
const DESCRIPTION_PLACEHOLDER: Record<IncidentType, string> = {
  accident:
    'E.g. Collided with a motorcycle at the intersection, minor damage to front bumper.',
  vehicle_breakdown:
    'E.g. Engine overheated on the highway, unable to continue driving.',
  health_emergency:
    'E.g. Feeling dizzy and unwell, unable to drive safely.',
  security_threat:
    'E.g. Unknown person attempted to open the cargo door at a stoplight.',
}

/** Before a type is picked there is nothing specific to model, so ask for the shape. */
const DESCRIPTION_PLACEHOLDER_GENERAL =
  'Tell us what happened. Include when it occurred and any other important details.'

export interface ReportFormValues extends CreateReportInput {}

interface Props {
  bookingId?: string | null
  /** Pre-filled when the driver is adding detail to a quick alert they already sent. */
  initial?: Partial<CreateReportInput>
  submitLabel?: string
  busy?: boolean
  error?: string | null
  onSubmit: (values: CreateReportInput) => void
}

export function ReportForm({
  bookingId, initial, submitLabel = 'Submit Report', busy = false, error, onSubmit,
}: Props) {
  const ctx = useReportContext(bookingId)

  const [type, setType]           = useState<IncidentType | null>(initial?.incident_type ?? null)
  const [subType, setSubType]     = useState<string | null>(initial?.sub_type ?? null)
  const [description, setDescription] = useState(initial?.description ?? '')
  const [photos, setPhotos]       = useState<string[]>([])
  const [videos, setVideos]       = useState<string[]>([])
  const [uploading, setUploading] = useState(false)
  const [mediaError, setMediaError] = useState<string | null>(null)

  const [withCheck, setWithCheck] = useState(false)
  const [items, setItems]         = useState<BlowbagetsItems>(NONE_CHECKED)

  const [canContinue, setCanContinue] = useState<boolean | null>(
    initial?.trip_can_continue ?? null,
  )

  const [touched, setTouched] = useState(false)

  // Only a breakdown gets the vehicle check. Bolting it onto an accident or a
  // hold-up would be asking a driver to inspect tyre pressure at the wrong
  // possible moment.
  const showCheck = type === 'vehicle_breakdown'

  const pickMedia = useCallback(async (kind: 'photo' | 'video') => {
    setMediaError(null)
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: kind === 'photo' ? ['images'] : ['videos'],
        quality:    0.6,
      })
      if (result.canceled || !result.assets?.length) return

      setUploading(true)
      // Uploaded immediately rather than at submit: evidence is the part of this
      // form most likely to be lost, and a driver who backs out of the screen
      // after picking three photos should not lose them with it.
      const url = await uploadProofPhoto(result.assets[0].uri)
      if (kind === 'photo') setPhotos((p) => [...p, url])
      else                  setVideos((v) => [...v, url])
    } catch (e: any) {
      setMediaError(e?.response?.data?.message ?? e?.message ?? 'That file could not be uploaded.')
    } finally {
      setUploading(false)
    }
  }, [])

  const missingType = !type
  const missingDesc = !description.trim()
  const missingSub  = !subType

  const submit = () => {
    setTouched(true)
    if (missingType || missingDesc || missingSub) return

    onSubmit({
      source:            'detailed',
      booking_id:        bookingId ?? null,
      incident_type:     type,
      sub_type:          subType,
      description:       description.trim(),
      photo_urls:        photos,
      video_urls:        videos,
      latitude:          ctx.latitude,
      longitude:         ctx.longitude,
      accuracy_m:        ctx.accuracy_m,
      address:           ctx.address,
      blowbagets_items:  showCheck && withCheck ? items : null,
      trip_can_continue: canContinue,
    })
  }

  return (
    <ScrollView
      contentContainerStyle={{ padding: 16, paddingBottom: 40, gap: 18 }}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      <ReportDetailsPanel ctx={ctx} />

      <Section title="TYPE OF INCIDENT" required hint="Tap one to add context to your report.">
        <IncidentTypeGrid
          value={type}
          onChange={(t) => { setType(t); setSubType(null) }}
          disabled={busy}
        />
        {touched && missingType ? <FieldError>Choose the type of incident.</FieldError> : null}
      </Section>

      {type && (
        <Section title="SUB-TYPE" required hint="Select what applies">
          {SUB_TYPES[type].map((option) => {
            const selected = subType === option
            return (
              <TouchableOpacity
                key={option}
                onPress={() => setSubType(option)}
                activeOpacity={0.8}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                style={{
                  paddingVertical: 11, paddingHorizontal: 12,
                  borderRadius: 8, borderWidth: 1,
                  borderColor: selected ? D.cyan : D.line,
                  backgroundColor: selected ? 'rgba(77,249,237,0.10)' : 'transparent',
                }}
              >
                <Text style={{
                  color: selected ? D.cyan : D.white, fontSize: 13,
                  fontFamily: FONTS.spartan.medium,
                }}>
                  {option}
                </Text>
              </TouchableOpacity>
            )
          })}
          {touched && missingSub ? <FieldError>Select what applies.</FieldError> : null}
        </Section>
      )}

      <Section title="DESCRIPTION" required>
        <TextInput
          value={description}
          onChangeText={setDescription}
          multiline
          editable={!busy}
          placeholder={type ? DESCRIPTION_PLACEHOLDER[type] : DESCRIPTION_PLACEHOLDER_GENERAL}
          placeholderTextColor={D.faint}
          style={{
            minHeight: 110, textAlignVertical: 'top',
            borderRadius: 8, borderWidth: 1, borderColor: D.line,
            backgroundColor: D.card, padding: 12,
            color: D.white, fontSize: 13, lineHeight: 19,
            fontFamily: FONTS.spartan.medium,
          }}
        />
        {touched && missingDesc ? <FieldError>Describe what happened.</FieldError> : null}
      </Section>

      <Section
        title="PHOTO/VIDEO UPLOAD"
        hint="Optional evidence for your report — file size should not exceed 20MB."
      >
        <View style={{ flexDirection: 'row', gap: 12 }}>
          <MediaTile
            icon={<ImageIcon size={22} color={D.faint} />}
            label="Add photo"
            disabled={busy || uploading}
            onPress={() => pickMedia('photo')}
          />
          <MediaTile
            icon={<Video size={22} color={D.faint} />}
            label="Add video"
            disabled={busy || uploading}
            onPress={() => pickMedia('video')}
          />
          {uploading && (
            <View style={{ justifyContent: 'center' }}>
              <ActivityIndicator size="small" color={D.cyan} />
            </View>
          )}
        </View>

        {(photos.length > 0 || videos.length > 0) && (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 }}>
            {photos.map((url) => (
              <View key={url} style={{ width: 62, height: 62, borderRadius: 8, overflow: 'hidden' }}>
                <Image source={{ uri: url }} style={{ width: '100%', height: '100%' }} />
                <TouchableOpacity
                  onPress={() => setPhotos((p) => p.filter((u) => u !== url))}
                  accessibilityRole="button"
                  accessibilityLabel="Remove photo"
                  style={{
                    position: 'absolute', top: 2, right: 2,
                    width: 18, height: 18, borderRadius: 999,
                    alignItems: 'center', justifyContent: 'center',
                    backgroundColor: 'rgba(0,0,0,0.7)',
                  }}
                >
                  <X size={11} color={D.white} />
                </TouchableOpacity>
              </View>
            ))}
            {videos.map((url) => (
              <View
                key={url}
                style={{
                  width: 62, height: 62, borderRadius: 8,
                  alignItems: 'center', justifyContent: 'center',
                  backgroundColor: D.inner, borderWidth: 1, borderColor: D.line,
                }}
              >
                <Video size={20} color={D.faint} />
                <TouchableOpacity
                  onPress={() => setVideos((v) => v.filter((u) => u !== url))}
                  accessibilityRole="button"
                  accessibilityLabel="Remove video"
                  style={{
                    position: 'absolute', top: 2, right: 2,
                    width: 18, height: 18, borderRadius: 999,
                    alignItems: 'center', justifyContent: 'center',
                    backgroundColor: 'rgba(0,0,0,0.7)',
                  }}
                >
                  <X size={11} color={D.white} />
                </TouchableOpacity>
              </View>
            ))}
          </View>
        )}

        {mediaError ? <FieldError>{mediaError}</FieldError> : null}
      </Section>

      {showCheck && (
        <Section title="BLOWBAGETS">
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Text style={{ color: D.faint, fontSize: 12, flex: 1, fontFamily: FONTS.spartan.medium }}>
              Include an updated vehicle check with this report?
            </Text>
            <Switch
              value={withCheck}
              onValueChange={setWithCheck}
              disabled={busy}
              trackColor={{ false: D.line, true: D.greenDim }}
              thumbColor={withCheck ? D.green : D.faint}
            />
          </View>

          {withCheck && (
            <>
              <Text style={{ color: D.faint, fontSize: 11, lineHeight: 16, fontFamily: FONTS.spartan.medium }}>
                Tick only what you actually checked — leave the rest alone. Mention anything that{' '}
                <Text style={{ color: D.red }}>failed</Text> in your description.
              </Text>

              {BLOWBAGETS.map(({ key, label, hint }) => {
                const on = items[key]
                return (
                  <TouchableOpacity
                    key={key}
                    onPress={() => setItems((prev) => ({ ...prev, [key]: !prev[key] }))}
                    activeOpacity={0.8}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: on }}
                    accessibilityLabel={`${label}: ${hint}`}
                    style={{
                      flexDirection: 'row', alignItems: 'center', gap: 10,
                      paddingVertical: 9, paddingHorizontal: 11,
                      borderRadius: 8, borderWidth: 1,
                      borderColor: on ? D.cyan : D.line,
                      backgroundColor: on ? 'rgba(77,249,237,0.08)' : 'transparent',
                    }}
                  >
                    <View style={{
                      width: 17, height: 17, borderRadius: 4,
                      alignItems: 'center', justifyContent: 'center',
                      borderWidth: 1, borderColor: on ? D.cyan : D.line,
                      backgroundColor: on ? D.cyanDim : 'transparent',
                    }}>
                      {on ? <Check size={12} color={D.cyan} strokeWidth={3} /> : null}
                    </View>
                    <Text style={{ color: D.white, fontSize: 13, width: 62, fontFamily: FONTS.spartan.bold }}>
                      {label}
                    </Text>
                    <Text style={{ color: D.faint, fontSize: 11, flex: 1, fontFamily: FONTS.spartan.medium }} numberOfLines={1}>
                      {hint}
                    </Text>
                  </TouchableOpacity>
                )
              })}
            </>
          )}
        </Section>
      )}

      {/* The operational question. Last, because it is the one thing whoever
          reads this acts on, and it should be the driver's final thought. */}
      <Section title="CAN THE TRIP CONTINUE?" required hint="Choose what applies">
        <View style={{ flexDirection: 'row', gap: 12 }}>
          <ChoiceButton
            label="No"
            tone={D.red}
            toneDim={D.redDim}
            selected={canContinue === false}
            onPress={() => setCanContinue(false)}
            disabled={busy}
          />
          <ChoiceButton
            label="Yes"
            tone={D.green}
            toneDim={D.greenDim}
            selected={canContinue === true}
            onPress={() => setCanContinue(true)}
            disabled={busy}
          />
        </View>
      </Section>

      {error ? <FieldError>{error}</FieldError> : null}

      <TouchableOpacity
        onPress={submit}
        disabled={busy}
        activeOpacity={0.85}
        accessibilityRole="button"
        style={{
          flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9,
          height: 48, borderRadius: 10,
          borderWidth: 1, borderColor: D.cyan, backgroundColor: D.cyanDim,
          opacity: busy ? 0.6 : 1,
        }}
      >
        {busy
          ? <ActivityIndicator size="small" color={D.cyan} />
          : <SendHorizontal size={18} color={D.cyan} strokeWidth={2} />}
        <Text style={{ color: D.cyan, fontSize: 15, fontFamily: FONTS.spartan.bold }}>
          {busy ? 'Sending…' : submitLabel}
        </Text>
      </TouchableOpacity>
    </ScrollView>
  )
}

/* ── Pieces ───────────────────────────────────────────────────────────────── */

function Section({
  title, hint, required = false, children,
}: {
  title:     string
  hint?:     string
  required?: boolean
  children:  React.ReactNode
}) {
  return (
    <View style={{ gap: 8 }}>
      <View style={{ gap: 2 }}>
        <Text style={{ color: D.white, fontSize: 13, letterSpacing: 0.5, fontFamily: FONTS.spartan.bold }}>
          {title}{required ? <Text style={{ color: D.red }}> *</Text> : null}
        </Text>
        {hint ? (
          <Text style={{ color: D.faint, fontSize: 11, fontFamily: FONTS.spartan.medium }}>{hint}</Text>
        ) : null}
      </View>
      {children}
    </View>
  )
}

function FieldError({ children }: { children: React.ReactNode }) {
  return (
    <Text style={{ color: D.red, fontSize: 11, lineHeight: 16, fontFamily: FONTS.spartan.medium }}>
      {children}
    </Text>
  )
}

function MediaTile({
  icon, label, onPress, disabled,
}: {
  icon:     React.ReactNode
  label:    string
  onPress:  () => void
  disabled: boolean
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.8}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={{
        width: 68, height: 68, borderRadius: 10,
        alignItems: 'center', justifyContent: 'center', gap: 5,
        borderWidth: 1, borderColor: D.line, backgroundColor: D.card,
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {icon}
      <Text style={{ color: D.faint, fontSize: 10, fontFamily: FONTS.spartan.medium }}>{label}</Text>
    </TouchableOpacity>
  )
}

function ChoiceButton({
  label, tone, toneDim, selected, onPress, disabled,
}: {
  label:    string
  tone:     string
  toneDim:  string
  selected: boolean
  onPress:  () => void
  disabled: boolean
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.85}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      style={{
        flex: 1, height: 42, borderRadius: 8,
        alignItems: 'center', justifyContent: 'center',
        borderWidth: selected ? 1.5 : 1,
        borderColor: tone,
        backgroundColor: selected ? toneDim : 'transparent',
      }}
    >
      <Text style={{ color: tone, fontSize: 14, fontFamily: FONTS.spartan.bold }}>{label}</Text>
    </TouchableOpacity>
  )
}
