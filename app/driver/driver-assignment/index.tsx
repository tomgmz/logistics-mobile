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
} from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import NetInfo from '@react-native-community/netinfo'
import { useDriverId, useAuthHydrated } from '../../../lib/store/auth.store'
import { useAvailabilityStore } from '../../../lib/store/availability.store'
import { FONTS } from '../../../lib/config/fonts'
import { Package, Search, Truck, TriangleAlert, WifiOff } from 'lucide-react-native'
import {
  BookingWithRelations,
  FILTERS,
  FilterKey,
  STATUS_CONFIG,
  bookingRef,
  fetchDriverBookings,
  filterBookings,
  formatCacheAge,
  formatDate,
  formatTime,
  getProgress,
  isFilterKey,
  readCache,
  resolveTruckLabel,
  writeCache,
} from '../../../lib/driverBookings'

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

  const ref = bookingRef(booking)

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
              {ref}
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

export default function DriverBookingList() {
  const router      = useRouter()
  const insets      = useSafeAreaInsets()
  const hasHydrated = useAuthHydrated()
  const driverId    = useDriverId()

  // Home deep-links straight to a tab: the active-order card lands on Active,
  // "See All" lands on All. Anything unrecognised falls back to All.
  const { filter: filterParam } = useLocalSearchParams<{ filter?: string }>()
  const requestedFilter = isFilterKey(filterParam) ? filterParam : 'All'

  const [bookings,     setBookings]     = useState<BookingWithRelations[]>([])
  const [loading,      setLoading]      = useState(true)
  const [refreshing,   setRefreshing]   = useState(false)
  const [error,        setError]        = useState<string | null>(null)
  const [activeFilter, setActiveFilter] = useState<FilterKey>(requestedFilter)
  const [offlineMeta,  setOfflineMeta]  = useState<{ savedAt: string } | null>(null)

  // Re-arriving from Home with a different tab in the URL wins over whatever
  // tab was left selected; tapping a tab here doesn't touch the param, so this
  // never fights the driver's own choice.
  useEffect(() => {
    setActiveFilter(requestedFilter)
  }, [requestedFilter])

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
      const fresh = await fetchDriverBookings(driverId)
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


      {/* "My Assignments" now lives in the top bar, so this is just the heading
          and the running total, per node 2734:1475. */}
      <View className="flex-row items-center justify-between px-6 pt-3.5 pb-4">
        <Text
          className="text-[36px] leading-[36px] text-ink-primary"
          style={{ fontFamily: FONTS.spartan.bold }}
        >
          BOOKINGS
        </Text>
        <View className="items-end">
          <Text
            className="text-[32px] leading-[32px] text-cyan"
            style={{ fontFamily: FONTS.spartan.bold }}
          >
            {bookings.length}
          </Text>
          <Text
            className="text-base leading-4 text-ink-faint"
            style={{ fontFamily: FONTS.spartan.medium }}
          >
            TOTAL
          </Text>
        </View>
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