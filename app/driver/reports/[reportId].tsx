import React, { useCallback, useEffect, useState } from 'react'
import {
  ActivityIndicator,
  Image,
  ScrollView,
  StatusBar,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Check, ChevronLeft, MapPin, TriangleAlert } from 'lucide-react-native'

import { FONTS } from '../../../lib/config/fonts'
import api from '../../../lib/api/auth.api'
import {
  enrichReport,
  INCIDENT_LABEL,
  STATUS_TONE,
  type CreateReportInput,
  type DriverReport,
} from '../../../lib/api/reports.api'
import { ReportForm } from '../../../components/reports/ReportForm'

/**
 * One report.
 *
 * Its job depends on how the report was raised, which is the point of quick
 * alerts and detailed reports sharing a record:
 *
 *   a QUICK ALERT opens as the FORM, pre-filled with whatever the alert carried.
 *   The signal is already out and somebody is already moving; this is where the
 *   driver says what actually happened, and it edits the same incident rather
 *   than filing a second one beside it.
 *
 *   a DETAILED report opens read-only. It has been filed; there is nothing left
 *   for the driver to do but see that it was received and what came of it.
 */

const D = {
  bg:    '#000000',
  card:  '#0e1010',
  inner: '#1b1b1b',
  line:  '#424242',
  white: '#ffffff',
  faint: '#818181',
  cyan:  '#4df9ed',
  red:   '#f62626',
  green: '#3af626',
}

export default function ReportDetailScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { reportId } = useLocalSearchParams<{ reportId: string }>()

  const [report, setReport]   = useState<DriverReport | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)
  const [busy, setBusy]       = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const { data } = await api.get(`/driver/reports/${reportId}`)
      setReport(data.data)
      setError(null)
    } catch (e: any) {
      setError(e?.response?.data?.message ?? 'That report could not be loaded.')
    } finally {
      setLoading(false)
    }
  }, [reportId])

  useEffect(() => { load() }, [load])

  const submit = async (values: CreateReportInput) => {
    setBusy(true)
    setSaveError(null)
    try {
      const updated = await enrichReport(reportId, values)
      setReport(updated)
    } catch (e: any) {
      setSaveError(
        e?.response?.data?.message ??
        'The details could not be saved. Check your signal and try again.',
      )
    } finally {
      setBusy(false)
    }
  }

  const tone  = report ? STATUS_TONE[report.status] : null
  const title = report?.incident_type ? INCIDENT_LABEL[report.incident_type] : 'UNSPECIFIED EMERGENCY'
  // A quick alert with nothing written on it is the one that still needs the
  // driver. Once it carries a description it is a filed report like any other.
  const needsDetail = !!report && report.source === 'quick' && !report.description?.trim()

  return (
    <View style={{ flex: 1, backgroundColor: D.bg }}>
      <StatusBar barStyle="light-content" backgroundColor="transparent" translucent />

      <View style={{
        flexDirection: 'row', alignItems: 'center', gap: 12,
        paddingHorizontal: 16, paddingTop: insets.top + 8, paddingBottom: 12,
      }}>
        <TouchableOpacity
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Go back"
          style={{
            width: 35, height: 35, borderRadius: 999,
            alignItems: 'center', justifyContent: 'center',
            borderWidth: 0.5, borderColor: D.line,
          }}
        >
          <ChevronLeft size={20} color={D.white} strokeWidth={2} />
        </TouchableOpacity>

        <View style={{ flex: 1 }}>
          <Text style={{ color: D.white, fontSize: 19, fontFamily: FONTS.spartan.bold }} numberOfLines={1}>
            {report ? title : 'Report'}
          </Text>
          {report?.bookings?.reference_number ? (
            <Text style={{ color: D.cyan, fontSize: 12, fontFamily: FONTS.spartan.medium }}>
              for {report.bookings.reference_number}
            </Text>
          ) : null}
        </View>

        {tone && (
          <View style={{
            flexDirection: 'row', alignItems: 'center', gap: 4,
            paddingHorizontal: 8, paddingVertical: 3, borderRadius: 16,
            borderWidth: 0.5, borderColor: tone.color, backgroundColor: tone.bg,
          }}>
            <View style={{ width: 5, height: 5, borderRadius: 999, backgroundColor: tone.color }} />
            <Text style={{ color: tone.color, fontSize: 9, fontFamily: FONTS.spartan.bold }}>
              {tone.label}
            </Text>
          </View>
        )}
      </View>

      {loading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator size="large" color={D.cyan} />
        </View>
      ) : error || !report ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, gap: 12 }}>
          <TriangleAlert size={38} color={D.red} />
          <Text style={{ color: D.faint, fontSize: 14, textAlign: 'center', fontFamily: FONTS.spartan.medium }}>
            {error ?? 'Report not found.'}
          </Text>
        </View>
      ) : needsDetail ? (
        <>
          <View style={{
            marginHorizontal: 16, marginBottom: 4, padding: 12,
            borderRadius: 10, borderWidth: 1, borderColor: D.cyan,
            backgroundColor: 'rgba(77,249,237,0.10)',
          }}>
            <Text style={{ color: D.cyan, fontSize: 13, fontFamily: FONTS.spartan.bold }}>
              ALERT SENT
            </Text>
            <Text style={{ color: D.white, fontSize: 12, lineHeight: 17, marginTop: 3, fontFamily: FONTS.spartan.medium }}>
              The Operations Manager has your location and vehicle. Add what happened below — it goes onto this
              same report, so nobody is looking at two.
            </Text>
          </View>

          <ReportForm
            bookingId={report.booking_id}
            initial={{
              incident_type:     report.incident_type,
              sub_type:          report.sub_type,
              description:       report.description,
              trip_can_continue: report.trip_can_continue,
            }}
            submitLabel="Add these details"
            busy={busy}
            error={saveError}
            onSubmit={submit}
          />
        </>
      ) : (
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40, gap: 14 }}>
          <Field label="TYPE"      value={title} />
          <Field label="SUB-TYPE"  value={report.sub_type ?? '—'} />
          <Field label="DESCRIPTION" value={report.description?.trim() || 'No description was given.'} />

          {report.address || report.latitude != null ? (
            <View style={{ gap: 6 }}>
              <Text style={{ color: D.white, fontSize: 12, letterSpacing: 0.5, fontFamily: FONTS.spartan.bold }}>
                LOCATION
              </Text>
              <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 7 }}>
                <MapPin size={14} color={D.faint} style={{ marginTop: 2 }} />
                <Text style={{ color: D.faint, fontSize: 13, flex: 1, lineHeight: 18, fontFamily: FONTS.spartan.medium }}>
                  {report.address ??
                    `${report.latitude!.toFixed(5)}, ${report.longitude!.toFixed(5)}`}
                </Text>
              </View>
            </View>
          ) : null}

          {report.trip_can_continue != null && (
            <Field
              label="CAN THE TRIP CONTINUE?"
              value={report.trip_can_continue ? 'Yes' : 'No — the trip cannot continue'}
              tone={report.trip_can_continue ? D.green : D.red}
            />
          )}

          {report.blowbagets_check && (() => {
            // A tick means the driver LOOKED AT that item, not that it passed —
            // they tick only what they actually checked, and anything wrong goes
            // in the description. So an unticked item must not be rendered as a
            // failure: that would turn "I didn't get to the brakes" into "the
            // brakes failed", which is a very different report.
            const entries  = Object.entries(report.blowbagets_check.items)
            const checked  = entries.filter(([, on]) => on).map(([k]) => k)
            const skipped  = entries.filter(([, on]) => !on).map(([k]) => k)

            return (
              <View style={{ gap: 6 }}>
                <Text style={{ color: D.white, fontSize: 12, letterSpacing: 0.5, fontFamily: FONTS.spartan.bold }}>
                  BLOWBAGETS
                </Text>
                <Text style={{ color: D.faint, fontSize: 11, fontFamily: FONTS.spartan.medium }}>
                  {checked.length} of {entries.length} items checked at the roadside.
                </Text>

                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                  {checked.map((key) => (
                    <View
                      key={key}
                      style={{
                        flexDirection: 'row', alignItems: 'center', gap: 4,
                        paddingHorizontal: 9, paddingVertical: 4, borderRadius: 999,
                        borderWidth: 0.5, borderColor: 'rgba(77,249,237,0.35)',
                        backgroundColor: 'rgba(77,249,237,0.10)',
                      }}
                    >
                      <Check size={10} color={D.cyan} strokeWidth={3} />
                      <Text style={{
                        color: D.cyan, fontSize: 11,
                        textTransform: 'capitalize', fontFamily: FONTS.spartan.medium,
                      }}>
                        {key}
                      </Text>
                    </View>
                  ))}
                </View>

                {skipped.length > 0 && (
                  <Text style={{ color: D.faint, fontSize: 11, lineHeight: 16, fontFamily: FONTS.spartan.medium }}>
                    Not checked: <Text style={{ textTransform: 'capitalize' }}>{skipped.join(', ')}</Text>
                  </Text>
                )}
              </View>
            )
          })()}

          {report.photo_urls.length > 0 && (
            <View style={{ gap: 6 }}>
              <Text style={{ color: D.white, fontSize: 12, letterSpacing: 0.5, fontFamily: FONTS.spartan.bold }}>
                EVIDENCE
              </Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {report.photo_urls.map((url) => (
                  <Image
                    key={url}
                    source={{ uri: url }}
                    style={{ width: 78, height: 78, borderRadius: 8, backgroundColor: D.inner }}
                  />
                ))}
              </View>
            </View>
          )}
        </ScrollView>
      )}
    </View>
  )
}

function Field({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <View style={{ gap: 4 }}>
      <Text style={{ color: D.white, fontSize: 12, letterSpacing: 0.5, fontFamily: FONTS.spartan.bold }}>
        {label}
      </Text>
      <Text style={{
        color: tone ?? D.faint, fontSize: 13, lineHeight: 19,
        fontFamily: FONTS.spartan.medium,
      }}>
        {value}
      </Text>
    </View>
  )
}
