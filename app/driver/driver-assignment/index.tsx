import React, { useEffect, useState, useCallback, useRef } from 'react'
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Animated,
  Pressable,
  Modal,
} from 'react-native'
import { useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import AsyncStorage from '@react-native-async-storage/async-storage'
import NetInfo from '@react-native-community/netinfo'
import api from '../../../lib/api/auth.api'
import { useDriverId, useAuthHydrated } from '../../../lib/store/auth.store'
import { useAvailabilityStore } from '../../../lib/store/availability.store'
import { Package, Search, Truck, TriangleAlert, WifiOff, Power } from 'lucide-react-native'

interface BookingDestination {
  destination_id:  string
  booking_id:      string
  address:         string
  sequence_order:  number
  status:          'pending' | 'delivered' | 'failed'
  delivered_at:    string | null
  notes:           string | null
  latitude:        number | null
  longitude:       number | null
  created_at:      string
}

interface TruckModel {
  model_id:     string
  name:         string
  vehicle_type: string
  image_url:    string | null
}

interface TruckAssignment {
  assignment_id: string
  truck_id:      string
  assigned_at:   string
  trucks: {
    plate_number: string
    status:       string | null
    model_id:     string | null
    truck_models: TruckModel | null 
  }
}

interface BookingClient {
  client_id:       string
  company_name:    string | null
  billing_address: string | null
  payment_terms:   number
  users: {
    first_name: string
    last_name:  string
    email:      string
    phone:      string | null
  }
}

interface BookingWithRelations {
  booking_id:          string
  client_id:           string
  origin:              string
  origin_latitude:     number | null
  origin_longitude:    number | null
  truck_type_needed:   string
  cargo_details:       string | null
  schedule_date:       string
  call_time:           string
  status:              'pending' | 'assigned' | 'in_transit' | 'completed' | 'cancelled'
  total_cost:          number | null
  estimated_delivery:  string | null
  required_volume_cbm: number | null
  required_weight_kg:  number | null
  required_length_cm:  number | null
  stackable_required:  boolean | null
  payment_terms:       string | null
  created_at:          string
  updated_at:          string
  clients:             BookingClient
  booking_destinations: BookingDestination[]
  truck_assignments:   TruckAssignment[]
}

interface CachePayload {
  bookings: BookingWithRelations[]
  savedAt:  string
}

type StatusKey = 'pending' | 'assigned' | 'in_transit' | 'completed' | 'cancelled'

const STATUS_CONFIG: Record<StatusKey, {
  label:   string
  badgeCn: string
  textCn:  string
  dotCn:   string
}> = {
  pending:    { label: 'Pending',   badgeCn: 'bg-amber-950',   textCn: 'text-amber-400',   dotCn: 'bg-amber-400'   },
  assigned:   { label: 'Assigned',  badgeCn: 'bg-blue-950',    textCn: 'text-blue-400',    dotCn: 'bg-blue-400'    },
  in_transit: { label: 'En Route',  badgeCn: 'bg-emerald-950', textCn: 'text-emerald-400', dotCn: 'bg-emerald-400' },
  completed:  { label: 'Delivered', badgeCn: 'bg-zinc-800',    textCn: 'text-zinc-400',    dotCn: 'bg-zinc-500'    },
  cancelled:  { label: 'Cancelled', badgeCn: 'bg-red-950',     textCn: 'text-red-400',     dotCn: 'bg-red-500'     },
}

function cacheKey(driverId: string) {
  return `bookings_driver_${driverId}`
}

async function readCache(driverId: string): Promise<CachePayload | null> {
  try {
    const raw = await AsyncStorage.getItem(cacheKey(driverId))
    if (!raw) return null
    return JSON.parse(raw) as CachePayload
  } catch {
    return null
  }
}

async function writeCache(driverId: string, bookings: BookingWithRelations[]) {
  try {
    const payload: CachePayload = { bookings, savedAt: new Date().toISOString() }
    await AsyncStorage.setItem(cacheKey(driverId), JSON.stringify(payload))
  } catch {
    // non-fatal
  }
}

function formatCacheAge(savedAt: string): string {
  const diffMs  = Date.now() - new Date(savedAt).getTime()
  const diffMin = Math.floor(diffMs / 60_000)
  if (diffMin < 1)  return 'just now'
  if (diffMin < 60) return `${diffMin}m ago`
  const diffH = Math.floor(diffMin / 60)
  if (diffH < 24)   return `${diffH}h ago`
  return `${Math.floor(diffH / 24)}d ago`
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-PH', {
    month: 'short', day: 'numeric', year: 'numeric',
  })
}

function formatTime(timeStr: string): string {
  const [h, m] = timeStr.split(':')
  const hour   = parseInt(h, 10)
  return `${hour % 12 || 12}:${m} ${hour >= 12 ? 'PM' : 'AM'}`
}

function getProgress(destinations: BookingDestination[]) {
  const done  = destinations.filter((d) => d.status === 'delivered').length
  const total = destinations.length
  return { done, total, pct: total ? done / total : 0 }
}

function resolveTruckLabel(
  truckAssignment: TruckAssignment | undefined,
  truckTypeNeeded: string,
): string {
  if (!truckAssignment) return truckTypeNeeded

  const { trucks } = truckAssignment
  const plate      = trucks?.plate_number ?? ''
  const modelName  = trucks?.truck_models?.name ?? trucks?.truck_models?.vehicle_type ?? ''

  if (plate && modelName) return `${plate} · ${modelName}`
  if (plate)              return plate
  if (modelName)          return modelName
  return truckTypeNeeded
}

interface BookingCardProps {
  booking: BookingWithRelations
  onPress: () => void
  index:   number
}

function BookingCard({ booking, onPress, index }: BookingCardProps) {
  const fadeAnim  = useRef(new Animated.Value(0)).current
  const slideAnim = useRef(new Animated.Value(20)).current
  const scaleAnim = useRef(new Animated.Value(1)).current

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1, duration: 320, delay: index * 65, useNativeDriver: true,
      }),
      Animated.spring(slideAnim, {
        toValue: 0, delay: index * 65, tension: 90, friction: 11, useNativeDriver: true,
      }),
    ]).start()
  }, [])

  const onPressIn  = () =>
    Animated.spring(scaleAnim, { toValue: 0.973, tension: 220, friction: 14, useNativeDriver: true }).start()
  const onPressOut = () =>
    Animated.spring(scaleAnim, { toValue: 1, tension: 220, friction: 14, useNativeDriver: true }).start()

  const cfg            = STATUS_CONFIG[booking.status] ?? STATUS_CONFIG.pending
  const { done, total, pct } = getProgress(booking.booking_destinations)

  const firstAssignment = booking.truck_assignments?.[0]
  const truckLabel      = resolveTruckLabel(firstAssignment, booking.truck_type_needed)

  const clientUser = booking.clients?.users
  const fullName   = clientUser
    ? `${clientUser.first_name} ${clientUser.last_name}`.trim()
    : '—'
  const company    = booking.clients?.company_name

  const lastStop = [...(booking.booking_destinations ?? [])]
    .sort((a, b) => b.sequence_order - a.sequence_order)[0]?.address

  const shortId = booking.booking_id.split('-')[0].toUpperCase()

  return (
    <Animated.View
      className="mb-3"
      style={{
        opacity:   fadeAnim,
        transform: [{ translateY: slideAnim }, { scale: scaleAnim }],
      }}
    >
      <Pressable
        onPress={onPress}
        onPressIn={onPressIn}
        onPressOut={onPressOut}
        className="card-dark"
        style={{
          shadowColor:   '#000',
          shadowOffset:  { width: 0, height: 2 },
          shadowOpacity: 0.4,
          shadowRadius:  8,
          elevation:     4,
        }}
      >
        {/* Row 1 — ID + status */}
        <View className="flex-row items-center justify-between mb-3">
          <View className="flex-row items-center gap-2">
            <Text className="text-[11px] font-black tracking-widest text-ink-primary font-mono">
              #{shortId}
            </Text>
            <View className="w-1 h-1 rounded-full bg-surface-overlay" />
            <Text className="text-xs text-ink-faint font-medium">
              {formatDate(booking.schedule_date)}
            </Text>
          </View>

          <View className={`pill ${cfg.badgeCn}`}>
            <View className={`w-1.5 h-1.5 rounded-full ${cfg.dotCn}`} />
            <Text className={`text-2xs font-bold tracking-wide ${cfg.textCn}`}>
              {cfg.label}
            </Text>
          </View>
        </View>

        {/* Row 2 — Client avatar + name + time */}
        <View className="flex-row items-center gap-2.5 mb-3">
          <View className="w-9 h-9 rounded-full bg-surface-border items-center justify-center">
            <Text className="text-sm font-black text-ink-primary">
              {(company ?? fullName).charAt(0).toUpperCase()}
            </Text>
          </View>

          <View className="flex-1">
            <Text className="text-sm font-bold text-ink-primary" numberOfLines={1}>
              {company ?? fullName}
            </Text>
            {company ? (
              <Text className="text-[11px] text-ink-faint mt-0.5" numberOfLines={1}>
                {fullName}
              </Text>
            ) : null}
          </View>

          <View className="bg-surface-elevated rounded-lg px-2 py-1">
            <Text className="text-[11px] font-semibold text-ink-muted">
              {formatTime(booking.call_time)}
            </Text>
          </View>
        </View>

        {/* Row 3 — Route */}
        <View className="surface-raised mb-3">
          <View className="flex-row items-center gap-2">
            <View className="w-2.5 h-2.5 rounded-full bg-ink-primary" />
            <Text className="flex-1 text-xs font-medium text-ink-secondary" numberOfLines={1}>
              {booking.origin}
            </Text>
          </View>

          {total > 0 && (
            <>
              <View className="w-px h-2.5 bg-surface-divider ml-[4.5px] my-0.5" />
              <View className="flex-row items-center gap-2">
                <View
                  className={`w-2.5 h-2.5 rounded-sm border-2 ${
                    booking.status === 'completed'
                      ? 'bg-emerald-500 border-emerald-500'
                      : 'bg-transparent border-ink-disabled'
                  }`}
                />
                <Text className="flex-1 text-xs font-medium text-ink-secondary" numberOfLines={1}>
                  {lastStop ?? '—'}
                </Text>
                {total > 1 && (
                  <View className="bg-surface-border rounded-md px-1.5 py-0.5">
                    <Text className="text-3xs font-bold text-ink-faint">
                      +{total - 1} stop{total > 2 ? 's' : ''}
                    </Text>
                  </View>
                )}
              </View>
            </>
          )}
        </View>

        {/* Row 4 — Progress bar */}
        {total > 0 && (
          <View className="flex-row items-center gap-2 mb-3">
            <View className="flex-1 h-1 bg-surface-border rounded-full overflow-hidden">
              <View
                className="h-full bg-emerald-500 rounded-full"
                style={{ width: `${pct * 100}%` }}
              />
            </View>
            <Text className="text-2xs font-semibold text-ink-faint w-12 text-right">
              {done}/{total} stops
            </Text>
          </View>
        )}

        {/* Row 5 — Truck chip + cost + arrow */}
        <View className="flex-row items-center gap-2">
          <View className="flex-1 bg-surface-elevated rounded-lg px-2.5 py-1.5 flex-row items-center gap-1.5">
            <Truck size={12} color="#818181" />
            <Text className="text-[11px] font-semibold text-ink-secondary flex-1" numberOfLines={1}>
              {truckLabel}
            </Text>
          </View>

          {booking.total_cost != null && (
            <Text className="text-sm font-black text-ink-primary">
              ₱{Number(booking.total_cost).toLocaleString('en-PH', { minimumFractionDigits: 2 })}
            </Text>
          )}

          <View className="w-7 h-7 rounded-full bg-ink-primary items-center justify-center">
            <Text
              className="text-surface-bg text-lg font-bold"
              style={{ marginTop: -2, marginLeft: 1 }}
            >
              ›
            </Text>
          </View>
        </View>
      </Pressable>
    </Animated.View>
  )
}

const FILTERS = ['All', 'Active', 'Pending', 'Completed'] as const
type FilterKey = typeof FILTERS[number]

function filterBookings(bookings: BookingWithRelations[], filter: FilterKey) {
  switch (filter) {
    case 'Active':    return bookings.filter((b) => b.status === 'in_transit' || b.status === 'assigned')
    case 'Pending':   return bookings.filter((b) => b.status === 'pending')
    case 'Completed': return bookings.filter((b) => b.status === 'completed'  || b.status === 'cancelled')
    default:          return bookings
  }
}

function EmptyState({ filter }: { filter: FilterKey }) {
  return (
    <View className="items-center justify-center py-20 px-8">
      <View className="mb-4">
        {filter === 'All'
          ? <Package color="#818181" size={48} />
          : <Search  color="#818181" size={48} />}
      </View>
      <Text className="text-base font-bold text-ink-primary mb-1">No bookings found</Text>
      <Text className="text-sm text-ink-faint text-center leading-5">
        {filter === 'All'
          ? "You haven't been assigned any bookings yet."
          : `No ${filter.toLowerCase()} bookings right now.`}
      </Text>
    </View>
  )
}

interface OfflineBannerProps {
  savedAt: string
  onRetry: () => void
}

function OfflineBanner({ savedAt, onRetry }: OfflineBannerProps) {
  const fadeAnim = useRef(new Animated.Value(0)).current

  useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: 1, duration: 280, useNativeDriver: true,
    }).start()
  }, [])

  return (
    <Animated.View style={{ opacity: fadeAnim }}>
      <View className="flex-row items-center justify-between mx-4 mb-3 px-3 py-2.5 rounded-xl bg-amber-950 border border-amber-900/60">
        <View className="flex-row items-center gap-2">
          <WifiOff size={14} color="#fbbf24" />
          <Text className="text-xs font-semibold text-amber-400">
            Offline — cached {formatCacheAge(savedAt)}
          </Text>
        </View>
        <TouchableOpacity onPress={onRetry} activeOpacity={0.7}>
          <Text className="text-xs font-bold text-amber-300">Retry</Text>
        </TouchableOpacity>
      </View>
    </Animated.View>
  )
}

/**
 * The driver's own on/off switch for delivery work.
 *
 * Operations only sees drivers who have turned this on, so a driver who never
 * flips it never gets assigned — which is deliberate: a new account starts off.
 * While a delivery is in flight the switch reads "On delivery" and is locked;
 * finishing the delivery stands them down and they opt back in from here.
 */
function AvailabilityToggle() {
  const status    = useAvailabilityStore((s) => s.status)
  const canToggle = useAvailabilityStore((s) => s.canToggle)
  const saving    = useAvailabilityStore((s) => s.saving)
  const setStatus = useAvailabilityStore((s) => s.setStatus)

  const isAvailable = status === 'available'
  const onDelivery  = status === 'assigned'
  const blocked     = status === 'on_leave' || status === 'inactive'

  const label = onDelivery ? 'On delivery'
    : blocked ? (status === 'on_leave' ? 'On leave' : 'Inactive')
    : isAvailable ? 'Accepting deliveries'
    : 'Not accepting'

  const tone = onDelivery ? { bg: 'bg-blue-950',   dot: 'bg-blue-400',   text: 'text-blue-400'   }
    : blocked            ? { bg: 'bg-zinc-800',    dot: 'bg-zinc-500',   text: 'text-zinc-400'   }
    : isAvailable        ? { bg: 'bg-emerald-950', dot: 'bg-emerald-400', text: 'text-emerald-400' }
    :                      { bg: 'bg-amber-950',   dot: 'bg-amber-400',  text: 'text-amber-400'  }

  const disabled = !canToggle || saving || status == null

  return (
    <TouchableOpacity
      onPress={() => { if (!disabled) void setStatus(isAvailable ? 'unavailable' : 'available').catch(() => {}) }}
      disabled={disabled}
      activeOpacity={0.75}
      accessibilityRole="switch"
      accessibilityState={{ checked: isAvailable, disabled }}
      accessibilityLabel={`Availability: ${label}`}
      className={`flex-row items-center gap-2 rounded-2xl px-3 py-2 ${tone.bg} ${disabled ? 'opacity-70' : ''}`}
    >
      {saving
        ? <ActivityIndicator size="small" color="#ffffff" />
        : <View className={`w-2 h-2 rounded-full ${tone.dot}`} />}
      <View>
        <Text className={`text-[11px] font-bold ${tone.text}`}>{label}</Text>
        {canToggle && !saving && (
          <Text className="text-[10px] text-ink-faint">
            Tap to turn {isAvailable ? 'off' : 'on'}
          </Text>
        )}
      </View>
      <Power size={13} color={disabled ? '#818181' : '#ffffff'} />
    </TouchableOpacity>
  )
}

/**
 * Shown once after a delivery ends. The server stands the driver down when the
 * booking completes, so without this they would silently stop receiving work —
 * the prompt is what makes that opt-out visible and reversible on the spot.
 */
function ReAvailablePrompt() {
  const visible     = useAvailabilityStore((s) => s.promptReAvailable)
  const saving      = useAvailabilityStore((s) => s.saving)
  const setStatus   = useAvailabilityStore((s) => s.setStatus)
  const clearPrompt = useAvailabilityStore((s) => s.clearPrompt)

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={clearPrompt}>
      <View className="flex-1 items-center justify-center bg-black/75 px-8">
        <View className="w-full rounded-2xl bg-surface-elevated border border-surface-border p-5 gap-3">
          <Text className="text-lg font-black text-ink-primary">Delivery complete</Text>
          <Text className="text-sm text-ink-muted leading-5">
            You&apos;ve been set to not accepting deliveries. Turn yourself back on to be
            considered for the next booking.
          </Text>
          <View className="flex-row gap-2 mt-1">
            <TouchableOpacity
              onPress={clearPrompt}
              disabled={saving}
              activeOpacity={0.8}
              className="flex-1 rounded-xl border border-surface-border py-3 items-center"
            >
              <Text className="text-sm font-bold text-ink-faint">Not now</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => { void setStatus('available').catch(() => {}) }}
              disabled={saving}
              activeOpacity={0.8}
              className="flex-1 rounded-xl bg-emerald-500 py-3 items-center"
            >
              <Text className="text-sm font-bold text-black">
                {saving ? 'Turning on…' : "I'm available"}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  )
}

export default function DriverBookingList() {
  const router      = useRouter()
  const insets      = useSafeAreaInsets()
  const hasHydrated = useAuthHydrated()
  const driverId    = useDriverId()

  const [bookings,     setBookings]     = useState<BookingWithRelations[]>([])
  const [loading,      setLoading]      = useState(true)
  const [refreshing,   setRefreshing]   = useState(false)
  const [error,        setError]        = useState<string | null>(null)
  const [activeFilter, setActiveFilter] = useState<FilterKey>('All')
  const [offlineMeta,  setOfflineMeta]  = useState<{ savedAt: string } | null>(null)

  const refreshAvailability = useAvailabilityStore((s) => s.refresh)

  const loadCacheThenFetch = useCallback(async (isRefresh = false) => {
    if (!hasHydrated || !driverId) return

    // Pulled alongside the bookings: this is also how a finished delivery is
    // noticed (the server drops the driver from 'assigned' to 'unavailable'),
    // which raises the "ready for another delivery?" prompt.
    void refreshAvailability()

    if (!isRefresh) {
      const cached = await readCache(driverId)
      if (cached) {
        setBookings(cached.bookings)
        setLoading(false)
      }
    }

    try {
      const { data } = await api.get(`/booking/driver/${driverId}`)
      const fresh: BookingWithRelations[] = data.data ?? []
      setBookings(fresh)
      setOfflineMeta(null)
      setError(null)
      await writeCache(driverId, fresh)
    } catch (err: any) {
      const cached = await readCache(driverId)
      if (cached) {
        setBookings(cached.bookings)
        setOfflineMeta({ savedAt: cached.savedAt })
        setError(null)
      } else {
        setError(err.message ?? 'Failed to load bookings')
      }
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [driverId, hasHydrated, refreshAvailability])

  useEffect(() => {
    if (!hasHydrated) return
    if (!driverId) {
      setLoading(false)
      setError('Not logged in as a driver')
      return
    }
    loadCacheThenFetch()
  }, [hasHydrated, driverId])

  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((state) => {
      if (state.isConnected && state.isInternetReachable !== false && offlineMeta) {
        loadCacheThenFetch(true)
      }
    })
    return () => unsubscribe()
  }, [offlineMeta, loadCacheThenFetch])

  const onRefresh = useCallback(() => {
    setRefreshing(true)
    loadCacheThenFetch(true)
  }, [loadCacheThenFetch])

  const displayed = filterBookings(bookings, activeFilter)
  const countFor  = (f: FilterKey) => filterBookings(bookings, f).length

  return (
    <View className="flex-1 bg-surface-bg">

      <ReAvailablePrompt />

      <View className="flex-row items-end justify-between px-5 pt-3 pb-3">
        <View>
          <Text className="label-mono text-ink-faint mb-0.5">My Assignments</Text>
          <Text className="text-[28px] font-black text-ink-primary tracking-tight leading-9">
            Bookings
          </Text>
        </View>
        <View className="bg-ink-primary rounded-2xl min-w-[44px] h-11 items-center justify-center px-3 mb-1">
          <Text className="text-surface-bg font-black text-xl">{bookings.length}</Text>
        </View>
      </View>

      {/* Nothing reaches this driver unless they turn themselves on here. */}
      <View className="px-4 pb-5">
        <AvailabilityToggle />
      </View>

      <View className="flex-row gap-1.5 px-4 pb-3">
        {FILTERS.map((f) => {
          const isActive = activeFilter === f
          const count    = countFor(f)
          return (
            <TouchableOpacity
              key={f}
              onPress={() => setActiveFilter(f)}
              activeOpacity={0.75}
              className={`flex-row items-center gap-1.5 ${isActive ? 'filter-tab-active' : 'filter-tab'}`}
            >
              <Text className={`text-[13px] font-semibold ${isActive ? 'text-surface-bg' : 'text-ink-faint'}`}>
                {f}
              </Text>
              {count > 0 && (
                <View
                  className={`rounded-full min-w-[18px] h-[18px] items-center justify-center px-1 ${
                    isActive ? 'bg-black/10' : 'bg-surface-border'
                  }`}
                >
                  <Text className={`text-2xs font-bold ${isActive ? 'text-surface-bg' : 'text-ink-muted'}`}>
                    {count}
                  </Text>
                </View>
              )}
            </TouchableOpacity>
          )
        })}
      </View>

      {loading ? (
        <View className="flex-1 items-center justify-center gap-3">
          <ActivityIndicator size="large" color="#ffffff" />
          <Text className="text-sm text-ink-faint font-medium mt-3">Loading your bookings…</Text>
        </View>
      ) : error ? (
        <View className="flex-1 items-center justify-center px-8">
          <View className="mb-3">
            <TriangleAlert size={40} color="#ef4444" />
          </View>
          <Text className="text-base font-bold text-ink-primary mb-1">Something went wrong</Text>
          <Text className="text-sm text-ink-faint text-center mb-4">{error}</Text>
          <TouchableOpacity
            onPress={() => loadCacheThenFetch()}
            activeOpacity={0.8}
            className="bg-ink-primary rounded-xl px-6 py-3"
          >
            <Text className="text-surface-bg font-bold text-sm">Try Again</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <>
          {offlineMeta && (
            <OfflineBanner
              savedAt={offlineMeta.savedAt}
              onRetry={() => loadCacheThenFetch(true)}
            />
          )}

          <FlatList
            data={displayed}
            keyExtractor={(item) => item.booking_id}
            contentContainerStyle={{
              paddingHorizontal: 16,
              paddingTop:        4,
              paddingBottom:     insets.bottom + 24,
            }}
            showsVerticalScrollIndicator={false}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={onRefresh}
                tintColor="#ffffff"
                colors={['#ffffff']}
              />
            }
            ListEmptyComponent={<EmptyState filter={activeFilter} />}
            renderItem={({ item, index }) => (
              <BookingCard
                booking={item}
                index={index}
                onPress={() =>
                  router.push({
                    pathname: '/driver/maps/[bookingId]',
                    params: { bookingId: item.booking_id },
                  })
                }
              />
            )}
          />
        </>
      )}
    </View>
  )
}