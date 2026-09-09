import React, { useState } from 'react'
import { StatusBar, Text, TouchableOpacity, View } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { ChevronLeft } from 'lucide-react-native'

import { FONTS } from '../../../lib/config/fonts'
import { createReport, type CreateReportInput } from '../../../lib/api/reports.api'
import { ReportForm } from '../../../components/reports/ReportForm'

/**
 * "Report a case" — the full form.
 *
 * Reached from the reports list's floating button, from the SOS control on the
 * navigation map, and from the quick alert's "report with details instead" link.
 * The booking is optional: a driver can raise something in the yard between
 * jobs, and the report is filed against the delivery only when there is one.
 *
 * Built from the Figma "Report a case" frame (2973:131).
 */

const D = {
  bg:    '#000000',
  line:  '#424242',
  white: '#ffffff',
  faint: '#818181',
  cyan:  '#4df9ed',
}

export default function NewReportScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { bookingId, ref, date } = useLocalSearchParams<{
    bookingId?: string
    ref?:       string
    date?:      string
  }>()

  const [busy, setBusy]   = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (values: CreateReportInput) => {
    setBusy(true)
    setError(null)
    try {
      const report = await createReport(values)
      // Replace rather than push: backing out of a report that has already been
      // filed should land on the list, not on the form that would file it again.
      router.replace(`/driver/reports/${report.report_id}`)
    } catch (e: any) {
      setError(
        e?.response?.data?.message ??
        'The report could not be sent. Check your signal and try again.',
      )
      setBusy(false)
    }
  }

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
          <Text style={{ color: D.white, fontSize: 21, fontFamily: FONTS.spartan.medium }}>
            Report a case
          </Text>
          {(ref || date) && (
            <Text style={{ color: D.faint, fontSize: 12, fontFamily: FONTS.spartan.medium }}>
              {ref ? <Text style={{ color: D.cyan }}>for {ref}</Text> : null}
              {ref && date ? '  ·  ' : ''}
              {date ?? ''}
            </Text>
          )}
        </View>
      </View>

      <ReportForm
        bookingId={bookingId ?? null}
        busy={busy}
        error={error}
        onSubmit={submit}
      />
    </View>
  )
}
