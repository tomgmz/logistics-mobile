import React, { useCallback, useEffect, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import NetInfo from '@react-native-community/netinfo'
import {
  AlertCircle,
  Boxes,
  ChevronLeft,
  Eye,
  Lock,
  MapPin,
  Navigation,
  Road,
  Truck,
  User,
  WifiOff,
} from 'lucide-react-native'

import api from '../../../lib/api/auth.api'
import { saveBookingCache, loadBookingCache } from '../../../lib/navCache'
import { bookingRef } from '../../../lib/driverBookings'
import { navigationGate, formatGateDate } from '../../../lib/deliveryWindow'
import { syncServerTime } from '../../../lib/serverTime'
import { FONTS } from '../../../lib/config/fonts'

/**
 * Assignment details, shown after a driver taps a booking and before navigation
 * starts. Read-only summary of the job — client, ordered stops, cargo and
 * vehicle — with "Start Navigation" handing off to the nav SDK screen.
 *
 * Built from the Figma "Assignments Details" frame (node 2868:9485).
 */

interface Props {
  bookingId: string
  /** `earlyStart` is true when the driver chose to run this ahead of its day. */
  onStart:    (earlyStart: boolean) => void
  onPreview?: () => void
  onBack?:    () => void
}

interface Destination {
  destination_id: string
  address:        string
  sequence_order: number
  status:         'pending' | 'delivered' | 'failed'
  latitude:       number | null
  longitude:      number | null
}

interface HandlingCode {
  code: string
  name: string
  type: string
}

interface CargoItem {
  item_id:         string
  product_text?:   string | null
  commodity_text?: string | null
  shc_text?:       string | null
  ashc_text?:      string | null
  products?:       { name: string; unit?: string | null } | null
  commodities?:    { name: string; category?: string | null } | null
  shc?:            HandlingCode | null
  ashc?:           HandlingCode | null
  quantity?:       number | null
  weight_kg?:      number | null
  volume_cbm?:     number | null
  length_cm?:      number | null
  width_cm?:       number | null
  height_cm?:      number | null
}

interface Booking {
  booking_id:        string
  reference_number?: string | null
  origin:            string
  status:            string
  schedule_date:     string
  call_time:         string
  truck_type_needed: string
  clients?: {
    company_name?: string | null
    users?: { first_name?: string; last_name?: string; phone?: string | null } | null
  } | null
  booking_destinations?: Destination[]
  booking_cargo_items?:  CargoItem[]
  truck_assignments?: Array<{
    trucks?: { plate_number?: string; truck_models?: { name?: string; vehicle_type?: string } | null } | null
  }>
}

const D = {
  bg:       '#000000',
  card:     '#0e1010',
  cardLine: '#424242',
  inner:    '#1b1b1b',
  white:    '#ffffff',
  faint:    '#818181',
  cyan:     '#4df9ed',
  cyanDim:  'rgba(77,249,237,0.19)',
  green:    '#3af626',
  greenDim: 'rgba(58,246,38,0.19)',
  red:      '#f62626',
  redDim:   'rgba(246,38,38,0.19)',
  divider:  'rgba(255,255,255,0.08)',
  amber:    '#f59e0b',
  amberBg:  '#1a1200',
}

/** The tag beside the booking ref — the design's cyan ACTIVE pill, per status. */
const STATUS_TAG: Record<string, { label: string; color: string; bg: string }> = {
  pending:    { label: 'PENDING',   color: '#8a38f5', bg: 'rgba(115,56,245,0.19)' },
  assigned:   { label: 'ASSIGNED',  color: D.cyan,    bg: D.cyanDim               },
  in_transit: { label: 'ACTIVE',    color: D.cyan,    bg: D.cyanDim               },
  completed:  { label: 'DELIVERED', color: D.faint,   bg: 'rgba(129,129,129,0.19)' },
  cancelled:  { label: 'CANCELLED', color: D.red,     bg: D.redDim                },
}

function fmtDate(d: string): string {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })
}

function fmtTime(t: string): string {
  if (!t) return ''
  const [h, m] = t.split(':')
  const hour = parseInt(h, 10)
  return `${hour % 12 || 12}:${m} ${hour >= 12 ? 'PM' : 'AM'}`
}

/** Prefer the catalogue row's name, fall back to the free-text the client typed. */
function pick(named: { name: string } | null | undefined, text: string | null | undefined): string | null {
  return named?.name ?? (text || null)
}

function codeLabel(code: HandlingCode | null | undefined, text: string | null | undefined): string | null {
  if (code) return code.code ? `${code.code}` : code.name
  return text || null
}

function dimensions(c: CargoItem): string | null {
  const { length_cm: l, width_cm: w, height_cm: h } = c
  if (l == null || w == null || h == null) return null
  return `${l} × ${w} × ${h} cm`
}

export default function BookingDetailsScreen({ bookingId, onStart, onPreview, onBack }: Props) {
  const insets = useSafeAreaInsets()

  const [loading,   setLoading]   = useState(true)
  const [error,     setError]     = useState<string | null>(null)
  const [booking,   setBooking]   = useState<Booking | null>(null)
  const [offline,   setOffline]   = useState(false)
  const [fromCache, setFromCache] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)

    // The gate below is only as good as our clock, and this is the screen where
    // it decides something. Re-sync in the background; the gate stays open until
    // it lands, and the server still refuses an early pickup either way.
    void syncServerTime()

    try {
      const { data } = await api.get(`/booking/${bookingId}`)
      setBooking(data.data)
      setFromCache(false)
      // Keep a copy so navigation can still derive its stops if the network
      // drops before/at start.
      saveBookingCache(bookingId, data.data)
    } catch (e: any) {
      // Network failed — fall back to the last cached copy if we have one, so
      // the driver still sees the job details instead of a dead end.
      const cached = await loadBookingCache<Booking>(bookingId)
      if (cached) {
        setBooking(cached)
        setFromCache(true)
      } else {
        setError(e?.response?.data?.message ?? e?.message ?? 'Failed to load booking.')
      }
    } finally {
      setLoading(false)
    }
  }, [bookingId])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    const unsub = NetInfo.addEventListener((s) => setOffline(!s.isConnected))
    return () => unsub()
  }, [])

  const gate = navigationGate(booking)

  /** The offline caveat, asked last so it wraps whichever start we're doing. */
  const startWithOfflineCheck = useCallback((earlyStart: boolean) => {
    if (offline) {
      Alert.alert(
        'You’re offline',
        'A new route can’t be started without a connection — the map provider needs network to build it. ' +
        'If this trip is already in progress, guidance will keep running on the route it already loaded.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Try anyway', style: 'default', onPress: () => onStart(earlyStart) },
        ],
      )
      return
    }
    onStart(earlyStart)
  }, [offline, onStart])

  const handleStart = useCallback(() => {
    // Locked because the booking isn't the driver's to run at all — not
    // something an override should be able to talk its way past.
    if (gate.reason === 'cancelled') {
      Alert.alert('Booking cancelled', 'This booking has been cancelled and can’t be delivered.')
      return
    }

    if (gate.reason === 'not_assigned') {
      Alert.alert(
        'Not ready to start',
        'This booking hasn’t been assigned for delivery yet. It will open once operations releases it.',
      )
      return
    }

    // Scheduled for a later day. Startable, but the driver has to mean it, and
    // the choice is recorded against the pickup.
    if (gate.reason === 'not_yet' && gate.scheduledFor) {
      Alert.alert(
        'Not scheduled until ' + formatGateDate(gate.scheduledFor),
        'Starting now records a pickup ahead of the scheduled day, and that gets flagged on the booking. ' +
        'Only do this if the job really has moved up.',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Start early',
            style: 'destructive',
            onPress: () => startWithOfflineCheck(true),
          },
        ],
      )
      return
    }

    startWithOfflineCheck(false)
  }, [gate.reason, gate.scheduledFor, startWithOfflineCheck])

  if (loading) {
    return (
      <View style={s.centered}>
        <ActivityIndicator size="large" color={D.cyan} />
        <Text style={s.centeredText}>Loading booking…</Text>
      </View>
    )
  }

  if (error || !booking) {
    return (
      <View style={[s.centered, { paddingHorizontal: 32 }]}>
        <AlertCircle size={40} color={D.red} />
        <Text style={s.errorText}>{error ?? 'Booking not found.'}</Text>
        <TouchableOpacity onPress={load} style={s.retryBtn}>
          <Text style={s.retryText}>Retry</Text>
        </TouchableOpacity>
        {onBack && (
          <TouchableOpacity onPress={onBack} style={{ marginTop: 4, paddingVertical: 8, paddingHorizontal: 24 }}>
            <Text style={s.centeredText}>Go back</Text>
          </TouchableOpacity>
        )}
      </View>
    )
  }

  const dropoffs = [...(booking.booking_destinations ?? [])]
    .filter((d) => d.status === 'pending')
    .sort((a, b) => a.sequence_order - b.sequence_order)

  const cargo   = booking.booking_cargo_items ?? []
  const client  = booking.clients
  const contact = client?.users
    ? `${client.users.first_name ?? ''} ${client.users.last_name ?? ''}`.trim()
    : ''

  const truck      = booking.truck_assignments?.[0]?.trucks
  const truckModel = truck?.truck_models?.name ?? truck?.truck_models?.vehicle_type ?? booking.truck_type_needed
  const plate      = truck?.plate_number

  const tag       = STATUS_TAG[booking.status] ?? STATUS_TAG.assigned
  const totalQty  = cargo.reduce((n, c) => n + (c.quantity ?? 0), 0)
  const itemsMeta = totalQty > 0 ? `${totalQty} ITEM${totalQty === 1 ? '' : 'S'}` : null

  // Cargo carries no destination link in the data, so it can only be named for a
  // drop-off when there is exactly one to name.
  const soleDropoff = dropoffs.length === 1

  return (
    <View style={s.root}>
      <StatusBar barStyle="light-content" backgroundColor="transparent" translucent />

      {/* Header — back, ref + schedule, status tag */}
      <View style={[s.header, { paddingTop: insets.top + 8 }]}>
        {onBack && (
          <TouchableOpacity
            onPress={onBack}
            activeOpacity={0.75}
            accessibilityRole="button"
            accessibilityLabel="Go back"
            style={s.backBtn}
          >
            <ChevronLeft size={20} color={D.white} strokeWidth={2} />
          </TouchableOpacity>
        )}

        <View style={s.headerText}>
          <Text style={s.ref} numberOfLines={1}>
            {bookingRef(booking)}
          </Text>
          <Text style={s.schedule} numberOfLines={1}>
            {fmtDate(booking.schedule_date)}
            {booking.call_time ? ` · ${fmtTime(booking.call_time)}` : ''}
          </Text>
        </View>

        <View style={[s.tag, { backgroundColor: tag.bg, borderColor: tag.color }]}>
          <View style={[s.tagDot, { backgroundColor: tag.color }]} />
          <Text style={[s.tagText, { color: tag.color }]}>{tag.label}</Text>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 24, paddingBottom: 140, gap: 15 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Client */}
        {(client?.company_name || contact) && (
          <Card icon={<User size={16} color={D.cyan} />} title="CLIENT">
            <Text style={s.company} numberOfLines={1}>
              {(client?.company_name ?? contact).toUpperCase()}
            </Text>
            {client?.company_name && contact ? (
              <Text style={s.clientLine} numberOfLines={1}>{contact}</Text>
            ) : null}
            {client?.users?.phone ? (
              <Text style={s.clientLine} numberOfLines={1}>{client.users.phone}</Text>
            ) : null}
          </Card>
        )}

        {/* Route */}
        <Card
          icon={<Road size={16} color={D.cyan} />}
          title="ROUTE"
          meta={`${dropoffs.length} DROP-OFF${dropoffs.length === 1 ? '' : 'S'}`}
        >
          <View style={s.innerBox}>
            <Stop tone="pickup" label="Pickup" address={booking.origin} last={dropoffs.length === 0} />
            {dropoffs.map((d, i) => (
              <Stop
                key={d.destination_id}
                tone="dropoff"
                label={`Drop-off ${i + 1}`}
                address={d.address}
                last={i === dropoffs.length - 1}
              />
            ))}
          </View>
        </Card>

        {/* Cargo */}
        {cargo.length > 0 && (
          <Card icon={<Boxes size={16} color={D.cyan} />} title="CARGO" meta={itemsMeta}>
            {cargo.map((c, i) => (
              <CargoBlock
                key={c.item_id}
                item={c}
                index={i}
                dropoffLabel={soleDropoff ? 'DROP-OFF 1' : null}
              />
            ))}
          </Card>
        )}

        {/* Vehicle */}
        <Card icon={<Truck size={16} color={D.cyan} />} title="VEHICLE">
          <Text style={s.vehicle} numberOfLines={1}>
            {plate ? <Text style={{ color: D.cyan }}>{plate} </Text> : null}
            <Text style={{ color: plate ? D.faint : D.cyan }}>{truckModel}</Text>
          </Text>
        </Card>
      </ScrollView>

      {/* Start navigation */}
      <View style={[s.dock, { paddingBottom: insets.bottom + 14 }]}>
        {offline && (
          <View style={s.offlineBanner}>
            <WifiOff size={15} color={D.amber} />
            <Text style={s.offlineText}>
              {fromCache
                ? 'Offline — showing the last saved copy. Reconnect to start a new route.'
                : 'Offline — reconnect to start a new route.'}
            </Text>
          </View>
        )}
        {gate.locked && (
          <View style={s.lockNote}>
            <Lock size={13} color={D.faint} />
            <Text style={s.lockText}>
              {gate.reason === 'cancelled'
                ? 'This booking has been cancelled.'
                : gate.reason === 'not_assigned'
                  ? 'Waiting on operations to release this booking.'
                  : `Navigation opens ${gate.scheduledFor ? formatGateDate(gate.scheduledFor) : 'on the scheduled day'}.`}
            </Text>
          </View>
        )}

        <TouchableOpacity
          activeOpacity={0.85}
          onPress={handleStart}
          accessibilityRole="button"
          accessibilityLabel={gate.locked ? 'Navigation locked until the scheduled day' : 'Start navigation'}
          style={[s.startBtn, gate.locked && s.startBtnLocked]}
        >
          {gate.locked
            ? <Lock size={18} color={D.faint} strokeWidth={2} />
            : <Navigation size={20} color={D.cyan} strokeWidth={2} />}
          <Text style={[s.startText, gate.locked && { color: D.faint }]}>Start Navigation</Text>
        </TouchableOpacity>

        {/* Always available: seeing the run is never gated, only running it. */}
        {onPreview && (
          <TouchableOpacity
            activeOpacity={0.75}
            onPress={onPreview}
            accessibilityRole="button"
            accessibilityLabel="Preview the route on a map, view only"
            style={s.previewBtn}
          >
            <Eye size={16} color={D.white} strokeWidth={2} />
            <Text style={s.previewText}>Preview route</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  )
}

/* ── Pieces ───────────────────────────────────────────────────────────── */

function Card({
  icon, title, meta, children,
}: {
  icon:      React.ReactNode
  title:     string
  meta?:     string | null
  children:  React.ReactNode
}) {
  return (
    <View style={s.card}>
      <View style={s.cardHead}>
        {icon}
        <Text style={s.cardTitle}>{title}</Text>
        {meta ? (
          <>
            <View style={s.metaDot} />
            <Text style={s.cardMeta}>{meta}</Text>
          </>
        ) : null}
      </View>
      {children}
    </View>
  )
}

function Stop({
  tone, label, address, last,
}: {
  tone:    'pickup' | 'dropoff'
  label:   string
  address: string
  last:    boolean
}) {
  const color = tone === 'pickup' ? D.green    : D.red
  const fill  = tone === 'pickup' ? D.greenDim : D.redDim

  return (
    <View style={s.stopRow}>
      <View style={s.stopRail}>
        <View style={[s.pin, { backgroundColor: fill, borderColor: color }]}>
          <MapPin size={14} color={color} strokeWidth={2} />
        </View>
        {!last && <View style={s.stopConnector} />}
      </View>
      <Text style={s.stopText} numberOfLines={2}>
        <Text style={{ color: D.faint }}>{label}: </Text>
        {address}
      </Text>
    </View>
  )
}

function CargoBlock({
  item, index, dropoffLabel,
}: {
  item:         CargoItem
  index:        number
  dropoffLabel: string | null
}) {
  const product   = pick(item.products, item.product_text)
  const commodity = pick(item.commodities, item.commodity_text)
  const shc       = codeLabel(item.shc,  item.shc_text)
  const ashc      = codeLabel(item.ashc, item.ashc_text)
  const dims      = dimensions(item)

  return (
    <View style={index > 0 ? { marginTop: 14 } : undefined}>
      <Text style={s.cargoHeading}>
        CARGO {index + 1}
        {dropoffLabel ? <Text style={{ color: D.faint }}> ({dropoffLabel})</Text> : null}
      </Text>

      <View style={s.innerBox}>
        <View style={s.cargoTop}>
          <View style={s.cargoTopLeft}>
            <Text style={s.cargoLabel}>Product</Text>
            <Text style={s.cargoProduct} numberOfLines={2}>{product ?? '—'}</Text>
          </View>
          {item.quantity != null && (
            <Text style={s.cargoQty}>
              <Text style={s.cargoQtyLabel}>Quantity: </Text>
              {item.quantity}
            </Text>
          )}
        </View>

        <SpecRow label="Commodity"            value={commodity} />
        <SpecRow label="Special Handling Code" value={shc} />
        <SpecRow label="Additional SHC"        value={ashc} />
        <SpecRow label="Weight" value={item.weight_kg  != null ? `${item.weight_kg} kg`   : null} accent />
        <SpecRow label="Volume" value={item.volume_cbm != null ? `${item.volume_cbm} CBM` : null} accent />
        <SpecRow label="L × W × H" value={dims} accent />
      </View>
    </View>
  )
}

/** One label/value line in the cargo table. Skipped entirely when unset. */
function SpecRow({
  label, value, accent = false,
}: {
  label:   string
  value:   string | null
  accent?: boolean
}) {
  if (!value) return null
  return (
    <View style={s.specRow}>
      <Text style={s.specLabel} numberOfLines={1}>{label}</Text>
      <Text style={[s.specValue, accent && { color: D.cyan }]} numberOfLines={1}>{value}</Text>
    </View>
  )
}

const s = StyleSheet.create({
  root: {
    flex:            1,
    backgroundColor: D.bg,
  },

  centered: {
    flex:            1,
    alignItems:      'center',
    justifyContent:  'center',
    backgroundColor: D.bg,
    gap:             12,
  },
  centeredText: {
    color:    D.faint,
    fontSize: 14,
  },
  errorText: {
    color:      D.red,
    fontSize:   14,
    textAlign:  'center',
    lineHeight: 22,
  },
  retryBtn: {
    marginTop:         12,
    paddingVertical:   10,
    paddingHorizontal: 28,
    borderRadius:      14,
    backgroundColor:   D.card,
    borderWidth:       1,
    borderColor:       D.cardLine,
  },
  retryText: {
    color:      D.cyan,
    fontSize:   14,
    fontWeight: '700',
  },

  header: {
    flexDirection:     'row',
    alignItems:        'flex-start',
    gap:               11,
    paddingHorizontal: 19,
    paddingBottom:     20,
  },
  // 35px circle on the card surface, as the design's back btn draws it.
  backBtn: {
    width:           35,
    height:          35,
    borderRadius:    17.5,
    backgroundColor: D.card,
    borderWidth:     0.5,
    borderColor:     D.cardLine,
    alignItems:      'center',
    justifyContent:  'center',
  },
  headerText: {
    flex:       1,
    paddingTop: 1,
  },
  ref: {
    color:      D.white,
    fontSize:   22,
    fontFamily: FONTS.spartan.medium,
  },
  schedule: {
    color:     D.cyan,
    fontSize:  12,
    marginTop: 5,
  },
  tag: {
    height:            18,
    marginTop:         8,
    flexDirection:     'row',
    alignItems:        'center',
    gap:               4,
    paddingHorizontal: 8,
    borderRadius:      16,
    borderWidth:       0.4,
  },
  tagDot: {
    width:        6,
    height:       6,
    borderRadius: 3,
  },
  tagText: {
    fontSize:   12,
    fontWeight: '600',
  },

  card: {
    backgroundColor: D.card,
    borderRadius:    15,
    borderWidth:     0.5,
    borderColor:     D.cardLine,
    padding:         15.5,
  },
  cardHead: {
    flexDirection: 'row',
    alignItems:    'center',
    gap:           4,
  },
  cardTitle: {
    color:      D.white,
    fontSize:   14,
    fontFamily: FONTS.spartan.medium,
  },
  metaDot: {
    width:           4,
    height:          4,
    borderRadius:    2,
    backgroundColor: D.faint,
    marginHorizontal: 3,
  },
  cardMeta: {
    color:    D.faint,
    fontSize: 14,
  },

  company: {
    color:      D.white,
    fontSize:   25,
    marginTop:  12,
    fontFamily: FONTS.spartan.bold,
  },
  clientLine: {
    color:     D.faint,
    fontSize:  14,
    marginTop: 5,
  },

  innerBox: {
    backgroundColor: D.inner,
    borderRadius:    10,
    padding:         12,
    marginTop:       12,
  },

  stopRow: {
    flexDirection: 'row',
    gap:           7,
  },
  stopRail: {
    alignItems: 'center',
  },
  pin: {
    width:          24,
    height:         24,
    borderRadius:   12,
    borderWidth:    0.5,
    alignItems:     'center',
    justifyContent: 'center',
  },
  stopConnector: {
    width:           1,
    height:          12,
    marginVertical:  1,
    backgroundColor: D.faint,
  },
  stopText: {
    flex:       1,
    color:      D.white,
    fontSize:   12,
    lineHeight: 16,
    paddingTop: 4,
  },

  cargoHeading: {
    color:      D.cyan,
    fontSize:   14,
    marginTop:  12,
    fontFamily: FONTS.spartan.medium,
  },

  cargoTop: {
    flexDirection:  'row',
    alignItems:     'flex-end',
    justifyContent: 'space-between',
    gap:            12,
    paddingBottom:  10,
  },
  cargoTopLeft: {
    flex: 1,
  },
  cargoLabel: {
    color:    D.faint,
    fontSize: 12,
  },
  cargoProduct: {
    color:      D.cyan,
    fontSize:   14,
    fontWeight: '700',
    marginTop:  3,
  },
  cargoQty: {
    color:      D.cyan,
    fontSize:   14,
    fontWeight: '700',
    textAlign:  'right',
  },
  cargoQtyLabel: {
    color:      D.white,
    fontWeight: '400',
  },

  specRow: {
    flexDirection:  'row',
    alignItems:     'center',
    justifyContent: 'space-between',
    gap:            12,
    paddingVertical: 5,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: D.divider,
  },
  specLabel: {
    color:      D.faint,
    fontSize:   14,
    flexShrink: 1,
  },
  specValue: {
    color:     D.white,
    fontSize:  14,
    textAlign: 'right',
  },

  vehicle: {
    fontSize:  14,
    marginTop: 12,
  },

  dock: {
    position:          'absolute',
    left:              0,
    right:             0,
    bottom:            0,
    paddingHorizontal: 24,
    paddingTop:        12,
    backgroundColor:   D.bg,
    borderTopWidth:    StyleSheet.hairlineWidth,
    borderTopColor:    D.divider,
  },
  offlineBanner: {
    flexDirection:     'row',
    alignItems:        'center',
    gap:               8,
    marginBottom:      10,
    paddingVertical:   9,
    paddingHorizontal: 12,
    borderRadius:      12,
    backgroundColor:   D.amberBg,
    borderWidth:       1,
    borderColor:       'rgba(245,158,11,0.35)',
  },
  offlineText: {
    color:      D.amber,
    fontSize:   12,
    fontWeight: '600',
    flex:       1,
  },
  startBtn: {
    height:          46,
    flexDirection:   'row',
    alignItems:      'center',
    justifyContent:  'center',
    gap:             9,
    borderRadius:    10,
    backgroundColor: D.cyanDim,
    borderWidth:     1,
    borderColor:     D.cyan,
  },
  startText: {
    color:      D.cyan,
    fontSize:   16,
    fontFamily: FONTS.spartan.bold,
  },
  // Locked reads as inert rather than broken: same shape, no cyan.
  startBtnLocked: {
    backgroundColor: 'transparent',
    borderColor:     D.cardLine,
  },

  lockNote: {
    flexDirection:  'row',
    alignItems:     'center',
    gap:            7,
    marginBottom:   10,
    justifyContent: 'center',
  },
  lockText: {
    color:    D.faint,
    fontSize: 12,
  },

  previewBtn: {
    height:         44,
    marginTop:      8,
    flexDirection:  'row',
    alignItems:     'center',
    justifyContent: 'center',
    gap:            8,
    borderRadius:   10,
    borderWidth:    0.5,
    borderColor:    D.cardLine,
    backgroundColor: D.card,
  },
  previewText: {
    color:      D.white,
    fontSize:   14,
    fontWeight: '600',
  },
})
