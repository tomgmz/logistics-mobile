import React, { useCallback, useEffect, useState } from 'react'
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'
import { useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { FileText, Plus, TriangleAlert } from 'lucide-react-native'

import { FONTS } from '../../../lib/config/fonts'
import {
  listMyReports,
  INCIDENT_LABEL,
  STATUS_TONE,
  type DriverReport,
  type ReportStatus,
} from '../../../lib/api/reports.api'
import { ReportOptionModal } from '../../../components/reports/ReportOptionModal'
import { QuickAlertModal } from '../../../components/reports/QuickAlertModal'

/**
 * REPORTS — everything this driver has raised from the road.
 *
 * This replaces the old "Maintenance" tab, which was a placeholder screen with
 * the word Maintenance on it. The rename is not cosmetic: what a driver files
 * mid-route is rarely maintenance. It is an accident, a hold-up, a colleague who
 * has collapsed. Filing those under Maintenance would have buried them, and
 * would have told the driver this screen was not for them.
 *
 * The floating button is the way in, and it forks: a one-tap alert, or the full
 * form. Both land in the same list, in the same order, whatever they were sent
 * as — see lib/api/reports.api.
 *
 * Built from the Figma "Reports" frame (2970:131).
 */

const D = {
  bg:    '#000000',
  card:  '#0e1010',
  line:  '#424242',
  inner: '#1b1b1b',
  white: '#ffffff',
  faint: '#818181',
  cyan:  '#4df9ed',
  red:   '#f62626',
}

const FILTERS = ['All', 'Reported', 'Acknowledged', 'Resolved'] as const
type FilterKey = typeof FILTERS[number]

const FILTER_STATUS: Record<Exclude<FilterKey, 'All'>, ReportStatus> = {
  Reported:     'reported',
  Acknowledged: 'acknowledged',
  Resolved:     'resolved',
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-PH', { month: 'long', day: 'numeric', year: 'numeric' })
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' })
}

export default function ReportsScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()

  const [reports, setReports]   = useState<DriverReport[]>([])
  const [loading, setLoading]   = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError]       = useState<string | null>(null)
  const [filter, setFilter]     = useState<FilterKey>('All')

  const [optionsOpen, setOptionsOpen] = useState(false)
  const [quickOpen, setQuickOpen]     = useState(false)

  const load = useCallback(async (isRefresh = false) => {
    if (!isRefresh) setLoading(true)
    try {
      setReports(await listMyReports())
      setError(null)
    } catch (e: any) {
      setError(e?.response?.data?.message ?? e?.message ?? 'Could not load your reports.')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const countFor = (f: FilterKey) =>
    f === 'All' ? reports.length : reports.filter((r) => r.status === FILTER_STATUS[f]).length

  const shown = filter === 'All'
    ? reports
    : reports.filter((r) => r.status === FILTER_STATUS[filter])

  // The alert is filed against whatever the driver is currently out on, so a
  // report raised mid-route reaches operations already attached to the delivery
  // it is about.
  const activeBookingId = reports.find((r) => r.booking_id)?.booking_id ?? null

  return (
    <View style={{ flex: 1, backgroundColor: D.bg }}>
      <View style={{
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
        paddingHorizontal: 24, paddingTop: 14, paddingBottom: 16,
      }}>
        <Text style={{ color: D.white, fontSize: 36, lineHeight: 36, fontFamily: FONTS.spartan.bold }}>
          REPORTS
        </Text>
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={{ color: D.cyan, fontSize: 32, lineHeight: 32, fontFamily: FONTS.spartan.bold }}>
            {reports.length}
          </Text>
          <Text style={{ color: D.faint, fontSize: 15, lineHeight: 16, fontFamily: FONTS.spartan.medium }}>
            TOTAL
          </Text>
        </View>
      </View>

      <View style={{ flexDirection: 'row', gap: 6, paddingHorizontal: 16, paddingBottom: 12 }}>
        {FILTERS.map((f) => {
          const active = filter === f
          const count  = countFor(f)
          return (
            <TouchableOpacity
              key={f}
              onPress={() => setFilter(f)}
              activeOpacity={0.75}
              style={{
                flexDirection: 'row', alignItems: 'center', gap: 6,
                paddingHorizontal: 11, paddingVertical: 7, borderRadius: 999,
                borderWidth: active ? 0 : 0.5, borderColor: D.line,
                backgroundColor: active ? D.white : 'transparent',
              }}
            >
              <Text style={{
                color: active ? '#000' : D.faint, fontSize: 12,
                fontFamily: FONTS.spartan.semiBold,
              }}>
                {f}
              </Text>
              {count > 0 && (
                <View style={{
                  minWidth: 17, height: 17, borderRadius: 999, paddingHorizontal: 4,
                  alignItems: 'center', justifyContent: 'center',
                  backgroundColor: active ? 'rgba(0,0,0,0.12)' : D.inner,
                }}>
                  <Text style={{
                    color: active ? '#000' : D.faint, fontSize: 10,
                    fontFamily: FONTS.spartan.bold,
                  }}>
                    {count}
                  </Text>
                </View>
              )}
            </TouchableOpacity>
          )
        })}
      </View>

      {loading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 }}>
          <ActivityIndicator size="large" color={D.cyan} />
          <Text style={{ color: D.faint, fontSize: 14, fontFamily: FONTS.spartan.medium }}>
            Loading your reports…
          </Text>
        </View>
      ) : error ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, gap: 12 }}>
          <TriangleAlert size={38} color={D.red} />
          <Text style={{ color: D.faint, fontSize: 14, textAlign: 'center', fontFamily: FONTS.spartan.medium }}>
            {error}
          </Text>
          <TouchableOpacity
            onPress={() => load()}
            style={{ paddingVertical: 10, paddingHorizontal: 24, borderRadius: 10, backgroundColor: D.white }}
          >
            <Text style={{ color: '#000', fontSize: 14, fontFamily: FONTS.spartan.bold }}>Try again</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={shown}
          keyExtractor={(r) => r.report_id}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: insets.bottom + 110 }}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => { setRefreshing(true); load(true) }}
              tintColor="#ffffff"
            />
          }
          ListEmptyComponent={
            <View style={{ alignItems: 'center', paddingVertical: 72, paddingHorizontal: 32, gap: 10 }}>
              <FileText size={44} color={D.faint} />
              <Text style={{ color: D.white, fontSize: 16, fontFamily: FONTS.spartan.bold }}>
                Nothing reported
              </Text>
              <Text style={{
                color: D.faint, fontSize: 13, textAlign: 'center', lineHeight: 19,
                fontFamily: FONTS.spartan.medium,
              }}>
                {filter === 'All'
                  ? 'Anything that happens on the road — a breakdown, an accident, a threat — is raised from the button below.'
                  : `Nothing ${filter.toLowerCase()} right now.`}
              </Text>
            </View>
          }
          renderItem={({ item }) => <ReportCard report={item} onPress={() => router.push(`/driver/reports/${item.report_id}`)} />}
        />
      )}

      {/* The way in. Kept floating and always reachable: the driver may open this
          screen for one reason only, and it is not to read the list. */}
      <TouchableOpacity
        onPress={() => setOptionsOpen(true)}
        activeOpacity={0.85}
        accessibilityRole="button"
        accessibilityLabel="Report a case"
        style={{
          position: 'absolute', right: 20, bottom: insets.bottom + 24,
          width: 56, height: 56, borderRadius: 999,
          alignItems: 'center', justifyContent: 'center',
          backgroundColor: D.cyan,
          shadowColor: '#000', shadowOpacity: 0.4, shadowRadius: 10,
          shadowOffset: { width: 0, height: 4 }, elevation: 6,
        }}
      >
        <Plus size={26} color="#000" strokeWidth={2.5} />
      </TouchableOpacity>

      <ReportOptionModal
        visible={optionsOpen}
        onQuickAlert={() => { setOptionsOpen(false); setQuickOpen(true) }}
        onDetailed={() => { setOptionsOpen(false); router.push('/driver/reports/new') }}
        onClose={() => setOptionsOpen(false)}
      />

      <QuickAlertModal
        visible={quickOpen}
        bookingId={activeBookingId}
        // Sending is the END of the quick path, not the start of a form.
        //
        // This used to push straight into the report so the driver could
        // describe it while fresh, which quietly turned the one gesture that
        // exists for "no time to fill anything in" into the long way round to
        // the same form. The alert is away; the driver is put back where they
        // were, with the new report at the top of their list.
        //
        // Adding detail stays possible and stays THEIRS to start — they tap the
        // report when the situation allows, which is the same way they add a
        // proof photo once signal returns.
        onSent={() => {
          setQuickOpen(false)
          load(true)
        }}
        onCancel={() => setQuickOpen(false)}
        onDetailed={() => { setQuickOpen(false); router.push('/driver/reports/new') }}
      />
    </View>
  )
}

function ReportCard({ report, onPress }: { report: DriverReport; onPress: () => void }) {
  const tone  = STATUS_TONE[report.status]
  const title = report.incident_type
    ? INCIDENT_LABEL[report.incident_type]
    : 'UNSPECIFIED EMERGENCY'

  const plate = report.trucks?.plate_number
  const model = report.trucks?.truck_models?.name ?? report.trucks?.truck_models?.vehicle_type

  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.85}
      style={{
        backgroundColor: D.card, borderWidth: 0.5, borderColor: D.line,
        borderRadius: 15, padding: 14, marginBottom: 12, gap: 9,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Text style={{ color: D.white, fontSize: 12, fontFamily: FONTS.spartan.bold }} numberOfLines={1}>
          {report.bookings?.reference_number ?? '—'}
        </Text>
        <View style={{ width: 3, height: 3, borderRadius: 999, backgroundColor: D.line }} />
        <Text style={{ color: D.faint, fontSize: 12, flex: 1, fontFamily: FONTS.spartan.medium }} numberOfLines={1}>
          {fmtDate(report.created_at)}
        </Text>
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
      </View>

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Text style={{ color: D.white, fontSize: 19, flex: 1, fontFamily: FONTS.spartan.bold }} numberOfLines={1}>
          {model && plate ? `${model} · ${plate}` : plate ?? title}
        </Text>
        <Text style={{ color: D.faint, fontSize: 11, fontFamily: FONTS.spartan.medium }}>
          {fmtTime(report.created_at)}
        </Text>
      </View>

      {/* The type is repeated here when the headline was taken by the vehicle —
          which of the four it was is the first thing anyone needs. */}
      {(model || plate) && (
        <Text style={{ color: D.faint, fontSize: 11, fontFamily: FONTS.spartan.bold }}>
          {title}{report.sub_type ? ` · ${report.sub_type}` : ''}
        </Text>
      )}

      <View style={{
        backgroundColor: D.inner, borderRadius: 10, padding: 10,
        flexDirection: 'row', alignItems: 'flex-start', gap: 7,
      }}>
        <FileText size={13} color={D.faint} style={{ marginTop: 1 }} />
        <Text style={{ color: D.faint, fontSize: 12, flex: 1, lineHeight: 17, fontFamily: FONTS.spartan.medium }} numberOfLines={2}>
          {report.description?.trim() || 'No description was given.'}
        </Text>
      </View>

      {report.trip_can_continue === false && (
        <Text style={{ color: D.red, fontSize: 11, fontFamily: FONTS.spartan.bold }}>
          THE TRIP CANNOT CONTINUE
        </Text>
      )}
    </TouchableOpacity>
  )
}
