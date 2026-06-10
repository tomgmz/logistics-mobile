import React, { useCallback, useEffect, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StatusBar,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import NetInfo from '@react-native-community/netinfo'
import { AlertCircle, ChevronLeft, MapPin, Navigation2, Package, Truck, User, WifiOff } from 'lucide-react-native'

import api from '../../../lib/api/auth.api'
import { saveBookingCache, loadBookingCache } from '../../../lib/navCache'
import { C } from '../../../theme/navigation.theme'

/**
 * Booking details shown after a driver taps a booking, before navigation starts.
 * Read-only summary of the job: client, schedule, ordered stops (pickup +
 * numbered drop-offs by sequence_order), cargo and truck. "Start navigation"
 * hands off to the Google Navigation SDK screen.
 */

interface Props {
  bookingId: string
  onStart:   () => void
  onBack?:   () => void
}

interface Destination {
  destination_id: string
  address:        string
  sequence_order: number
  status:         'pending' | 'delivered' | 'failed'
  latitude:       number | null
  longitude:      number | null
}

interface CargoItem {
  item_id:         string
  product_text?:   string | null
  commodity_text?: string | null
  products?:       { name: string } | null
  commodities?:    { name: string } | null
  quantity?:       number | null
  weight_kg?:      number | null
  volume_cbm?:     number | null
}

interface Booking {
  booking_id:        string
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

const STATUS_COLOR: Record<string, string> = {
  pending:    C.orange,
  assigned:   C.cyan,
  in_transit: C.green,
  completed:  C.dimWhite,
  cancelled:  C.red,
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

function cargoLabel(c: CargoItem): string {
  return c.products?.name ?? c.product_text ?? c.commodities?.name ?? c.commodity_text ?? 'Item'
}

export default function BookingDetailsScreen({ bookingId, onStart, onBack }: Props) {
  const insets = useSafeAreaInsets()

  const [loading,    setLoading]    = useState(true)
  const [error,      setError]      = useState<string | null>(null)
  const [booking,    setBooking]    = useState<Booking | null>(null)
  const [offline,    setOffline]    = useState(false)
  const [fromCache,  setFromCache]  = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
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

  const handleStart = useCallback(() => {
    if (offline) {
      Alert.alert(
        'You’re offline',
        'A new route can’t be started without a connection — the map provider needs network to build it. ' +
        'If this trip is already in progress, guidance will keep running on the route it already loaded.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Try anyway', style: 'default', onPress: onStart },
        ],
      )
      return
    }
    onStart()
  }, [offline, onStart])

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: C.bg, gap: 12 }}>
        <ActivityIndicator size="large" color={C.cyan} />
        <Text style={{ color: C.dimWhite, fontSize: 14 }}>Loading booking…</Text>
      </View>
    )
  }

  if (error || !booking) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, backgroundColor: C.bg, gap: 12 }}>
        <AlertCircle size={40} color={C.red} />
        <Text style={{ color: C.red, fontSize: 14, textAlign: 'center', lineHeight: 22 }}>{error ?? 'Booking not found.'}</Text>
        <TouchableOpacity
          onPress={load}
          style={{ marginTop: 12, paddingVertical: 10, paddingHorizontal: 28, borderRadius: 14, backgroundColor: C.surfaceHi, borderWidth: 1, borderColor: C.border }}
        >
          <Text style={{ color: C.cyan, fontSize: 14, fontWeight: '700' }}>Retry</Text>
        </TouchableOpacity>
        {onBack && (
          <TouchableOpacity onPress={onBack} style={{ marginTop: 4, paddingVertical: 8, paddingHorizontal: 24 }}>
            <Text style={{ color: C.dimWhite, fontSize: 13 }}>Go back</Text>
          </TouchableOpacity>
        )}
      </View>
    )
  }

  const dropoffs = [...(booking.booking_destinations ?? [])]
    .filter((d) => d.status === 'pending')
    .sort((a, b) => a.sequence_order - b.sequence_order)

  const cargo  = booking.booking_cargo_items ?? []
  const client = booking.clients
  const contact = client?.users
    ? `${client.users.first_name ?? ''} ${client.users.last_name ?? ''}`.trim()
    : ''
  const truck = booking.truck_assignments?.[0]?.trucks
  const truckLabel = truck
    ? [truck.plate_number, truck.truck_models?.name ?? truck.truck_models?.vehicle_type].filter(Boolean).join(' · ')
    : booking.truck_type_needed
  const statusColor = STATUS_COLOR[booking.status] ?? C.dimWhite

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <StatusBar barStyle="light-content" backgroundColor="transparent" translucent />

      {/* Header */}
      <View style={{ paddingTop: insets.top + 12, paddingHorizontal: 16, paddingBottom: 12, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        {onBack && (
          <TouchableOpacity
            onPress={onBack}
            style={{ width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: C.surfaceHi, borderWidth: 1, borderColor: C.border }}
          >
            <ChevronLeft size={22} color={C.white} />
          </TouchableOpacity>
        )}
        <View style={{ flex: 1 }}>
          <Text style={{ color: C.white, fontSize: 18, fontWeight: '900', letterSpacing: -0.4 }}>
            #{booking.booking_id.split('-')[0].toUpperCase()}
          </Text>
          <Text style={{ color: C.dimWhite, fontSize: 12, marginTop: 2 }}>
            {fmtDate(booking.schedule_date)}{booking.call_time ? ` · ${fmtTime(booking.call_time)}` : ''}
          </Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, backgroundColor: C.surfaceHi, borderWidth: 1, borderColor: statusColor }}>
          <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: statusColor }} />
          <Text style={{ color: statusColor, fontSize: 11, fontWeight: '700', textTransform: 'capitalize' }}>
            {booking.status.replace('_', ' ')}
          </Text>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 120, gap: 14 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Client */}
        {(client?.company_name || contact) && (
          <Card>
            <Row icon={<User size={15} color={C.cyan} />} title="Client" />
            <Text style={{ color: C.white, fontSize: 15, fontWeight: '700', marginTop: 6 }}>
              {client?.company_name ?? contact}
            </Text>
            {client?.company_name && contact ? (
              <Text style={{ color: C.dimWhite, fontSize: 13, marginTop: 2 }}>{contact}</Text>
            ) : null}
            {client?.users?.phone ? (
              <Text style={{ color: C.dimWhite, fontSize: 13, marginTop: 2 }}>{client.users.phone}</Text>
            ) : null}
          </Card>
        )}

        {/* Route / stops */}
        <Card>
          <Row icon={<MapPin size={15} color={C.cyan} />} title={`Route · ${dropoffs.length} drop-off${dropoffs.length !== 1 ? 's' : ''}`} />

          {/* Pickup */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 10 }}>
            <View style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: C.cyanDim, borderWidth: 1, borderColor: C.cyan, alignItems: 'center', justifyContent: 'center' }}>
              <Truck size={12} color={C.cyan} />
            </View>
            <Text style={{ color: C.white, fontSize: 13, flex: 1 }} numberOfLines={2}>
              <Text style={{ color: C.dimWhite }}>Pickup: </Text>{booking.origin}
            </Text>
          </View>

          {/* Numbered drop-offs */}
          {dropoffs.map((d, i) => (
            <View key={d.destination_id} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 10 }}>
              <View style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: C.orangeDim, borderWidth: 1, borderColor: C.orange, alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ color: C.orange, fontSize: 12, fontWeight: '900' }}>{i + 1}</Text>
              </View>
              <Text style={{ color: C.white, fontSize: 13, flex: 1 }} numberOfLines={2}>
                <Text style={{ color: C.dimWhite }}>Drop-off {i + 1}: </Text>{d.address}
              </Text>
            </View>
          ))}
        </Card>

        {/* Cargo */}
        {cargo.length > 0 && (
          <Card>
            <Row icon={<Package size={15} color={C.cyan} />} title={`Cargo · ${cargo.length} item${cargo.length !== 1 ? 's' : ''}`} />
            {cargo.map((c) => {
              const meta = [
                c.quantity   != null ? `${c.quantity} pcs`   : null,
                c.weight_kg  != null ? `${c.weight_kg} kg`    : null,
                c.volume_cbm != null ? `${c.volume_cbm} cbm`  : null,
              ].filter(Boolean).join('  ·  ')
              return (
                <View key={c.item_id} style={{ marginTop: 8 }}>
                  <Text style={{ color: C.white, fontSize: 13, fontWeight: '600' }}>{cargoLabel(c)}</Text>
                  {meta ? <Text style={{ color: C.dimWhite, fontSize: 12, marginTop: 1 }}>{meta}</Text> : null}
                </View>
              )
            })}
          </Card>
        )}

        {/* Truck */}
        <Card>
          <Row icon={<Truck size={15} color={C.cyan} />} title="Truck" />
          <Text style={{ color: C.white, fontSize: 14, fontWeight: '600', marginTop: 6 }}>{truckLabel}</Text>
        </Card>
      </ScrollView>

      {/* Start navigation button */}
      <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 16, paddingTop: 12, paddingBottom: insets.bottom + 14, backgroundColor: C.surface, borderTopWidth: 1, borderColor: C.border }}>
        {offline && (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10, paddingVertical: 9, paddingHorizontal: 12, borderRadius: 12, backgroundColor: C.offlineBg, borderWidth: 1, borderColor: C.offlineBorder }}>
            <WifiOff size={15} color={C.orange} />
            <Text style={{ color: C.orange, fontSize: 12, fontWeight: '600', flex: 1 }}>
              {fromCache
                ? 'Offline — showing the last saved copy. Reconnect to start a new route.'
                : 'Offline — reconnect to start a new route.'}
            </Text>
          </View>
        )}
        <TouchableOpacity
          activeOpacity={0.85}
          onPress={handleStart}
          style={{
            flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
            paddingVertical: 15, borderRadius: 16, backgroundColor: C.cyan,
            shadowColor: C.cyan, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.4, shadowRadius: 12, elevation: 8,
          }}
        >
          <Navigation2 size={18} color="#000" />
          <Text style={{ color: '#000', fontSize: 15, fontWeight: '800', letterSpacing: 0.2 }}>Start navigation</Text>
        </TouchableOpacity>
      </View>
    </View>
  )
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <View style={{ backgroundColor: C.surfaceHi, borderRadius: 16, borderWidth: 1, borderColor: C.border, padding: 14 }}>
      {children}
    </View>
  )
}

function Row({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      {icon}
      <Text style={{ color: C.dimWhite, fontSize: 11, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase' }}>
        {title}
      </Text>
    </View>
  )
}
