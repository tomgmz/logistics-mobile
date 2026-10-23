/**
 * The driver's landing page after sign-in.
 *
 * Built from the 8338 Logistics Figma "Home" frame (node 2727:1297). It is a
 * launcher, not a list: one hero shortcut into the live route, two quick
 * actions, and the single order the driver is working on right now. Anything
 * beyond that lives in My Assignments — the card opens it on the Active tab,
 * "See All" opens it on All.
 */
import React, { useCallback, useState } from 'react'
import {
  View,
  Text,
  Image,
  Pressable,
  ScrollView,
  RefreshControl,
  ActivityIndicator,
} from 'react-native'
import { useFocusEffect, useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { ChevronsRight, ChevronRight, PackageOpen } from 'lucide-react-native'

import { useDriverId, useAuthHydrated, useAuthStore } from '../../../lib/store/auth.store'
import { useLiveSignal } from '../../../hooks/useLiveSignal'
import { useAvailabilityStore } from '../../../lib/store/availability.store'
import AvailabilityToggle from '../../../components/ui/AvailabilityToggle'
import CoachMarkTour, { CoachStep } from '../../../components/CoachMarkTour'
import { useCoachTarget } from '../../../lib/coachMarks'
import { FONTS } from '../../../lib/config/fonts'
import {
  BookingWithRelations,
  bookingRef,
  fetchDriverBookings,
  filterBookings,
  statusConfigFor,
  formatDate,
  formatTime,
  getProgress,
  readCache,
  writeCache,
} from '../../../lib/driverBookings'

const routeMapImg   = require('../../../assets/home/route-map.png')
const mapIconImg    = require('../../../assets/home/icon-map.png')
// Still the wrench asset — the module was renamed to Reports, the artwork was not.
const wrenchIconImg = require('../../../assets/home/icon-maintenance.png')
const truckIconImg  = require('../../../assets/home/icon-vehicle.png')

const CYAN     = '#4df9ed'
const CARD_INK = '#0e1010'

/** How many route lines fit in the card's route box before it collapses. */
const ROUTE_PREVIEW_STOPS = 3

/** Height the docked availability switch reserves at the foot of the scroll. */
const DOCK_HEIGHT = 74

/**
 * First-visit tour of Home. The top-bar step points into the driver layout's
 * bar, which tags its own buttons with the same id.
 */
const HOME_TOUR: CoachStep[] = [
  {
    target: 'home.availability',
    title:  'Turn yourself on',
    body:   'Switch this on when you can work. No delivery reaches you while it is off. Tap it to pick the days you can work.',
  },
  {
    target: 'home.order',
    title:  'Your current order',
    body:   'The delivery you are working on shows here. Tap it for the client, cargo, vehicle and route. "See All" lists every assignment.',
  },
  {
    target: 'home.routes',
    title:  'Check your routes',
    body:   'A shortcut straight into your current delivery, where you start navigation.',
  },
  {
    target: 'home.quick',
    title:  'Maps and Reports',
    body:   'Maps lets you look around and search places. Reports is where you raise an accident, breakdown or delay, or send a quick alert.',
  },
  {
    target: 'topbar.actions',
    title:  'Messages, alerts and your account',
    body:   'Chat with the office and your client, see your notifications, and open your profile to sign out.',
  },
]

/** The same tour for a vendor's driver, who has no work-schedule calendar. */
const VENDOR_HOME_TOUR: CoachStep[] = HOME_TOUR.filter((st) => st.target !== 'home.availability')

export default function DriverHome() {
  const router      = useRouter()
  const insets      = useSafeAreaInsets()
  const hasHydrated = useAuthHydrated()
  const driverId    = useDriverId()
  const isVendorDriver = useAuthStore((s) => s.user?.drivers?.is_external === true)

  const [bookings,   setBookings]   = useState<BookingWithRelations[]>([])
  const [loading,    setLoading]    = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  const refreshAvailability = useAvailabilityStore((s) => s.refresh)

  const availabilityTarget = useCoachTarget('home.availability')
  const orderTarget        = useCoachTarget('home.order')
  const routesTarget       = useCoachTarget('home.routes')
  const quickTarget        = useCoachTarget('home.quick')

  const load = useCallback(async (isRefresh = false) => {
    if (!hasHydrated || !driverId) return

    // The docked switch is only as truthful as the last refresh, and this is the
    // screen the driver opens first — so pull it alongside the bookings.
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
      await writeCache(driverId, fresh)
    } catch {
      // Offline is not an error here — the cache above already filled the card,
      // and My Assignments is where the driver gets the offline banner.
      const cached = await readCache(driverId)
      if (cached) setBookings(cached.bookings)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [driverId, hasHydrated, refreshAvailability])

  // Re-read whenever home is shown (first open included): back from starting a
  // trip, the pill has to move from "Assigned" to "On delivery", and a booking
  // assigned while the driver was on another screen has to be on the card.
  useFocusEffect(useCallback(() => {
    if (!hasHydrated) return
    if (!driverId) { setLoading(false); return }
    void load()
  }, [hasHydrated, driverId, load]))

  // Live: a booking assigned to this driver (or taken off them) shows up on the
  // card without a pull-to-refresh. Assigning writes the booking and delivery
  // rows, which fire `live:bookings`; the signal carries only an id, so the list
  // is re-read from the API, which scopes it to this driver. Also re-read when
  // the app returns to the foreground (signals sent in the background are lost).
  useLiveSignal('live:bookings', () => { void load(true) }, {
    enabled: hasHydrated && !!driverId,
    debounceMs: 1000,
  })

  const onRefresh = useCallback(() => {
    setRefreshing(true)
    load(true)
  }, [load])

  const active  = filterBookings(bookings, 'Active')
  const current = active[0]

  const openAssignments = (filter: 'All' | 'Active') =>
    router.push({ pathname: '/driver/driver-assignment', params: { filter } })

  /** The active order card opens that booking's own details, not the list. */
  const openBooking = (bookingId: string) =>
    router.push({ pathname: '/driver/maps/[bookingId]', params: { bookingId } })

  /** "Check your routes" only means something when there is a route to check. */
  const openRoute = () => {
    if (current) {
      router.push({
        pathname: '/driver/maps/[bookingId]',
        params: { bookingId: current.booking_id },
      })
    } else {
      openAssignments('Active')
    }
  }

  return (
    <View className="flex-1 bg-black">
      <ScrollView
        className="flex-1"
        // Leave room for the docked switch so the last card never hides behind it.
        contentContainerStyle={{ paddingBottom: insets.bottom + (isVendorDriver ? 0 : DOCK_HEIGHT) + 24 }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor="#ffffff"
            colors={['#ffffff']}
          />
        }
      >
        {/* Soft white bloom behind the hero, as in the design (Ellipse 2). */}
        <View
          pointerEvents="none"
          className="absolute -left-24 -right-24 top-24 h-[360px] rounded-full bg-white/[0.05]"
        />

        <View className="px-6 pt-2.5">
          <View ref={routesTarget} collapsable={false}>
            <HeroCard onPress={openRoute} />
          </View>

          <View ref={quickTarget} collapsable={false} className="flex-row gap-[5px] mt-[9px]">
            <QuickAction
              icon={<Image source={mapIconImg} style={{ width: 17.5, height: 17.5 }} resizeMode="contain" />}
              label="Maps"
              onPress={() => router.push('/driver/maps')}
            />
            <QuickAction
              icon={<Image source={wrenchIconImg} style={{ width: 18, height: 18 }} resizeMode="contain" />}
              label="Reports"
              onPress={() => router.push('/driver/reports')}
            />
          </View>

          <View className="flex-row items-center justify-between mt-6 mb-3">
            <Text
              className="text-2xl text-white"
              style={{ fontFamily: FONTS.spartan.bold }}
            >
              Active Orders
            </Text>
            <Pressable
              onPress={() => openAssignments('All')}
              hitSlop={{ top: 10, bottom: 10, left: 12, right: 12 }}
              accessibilityRole="button"
              accessibilityLabel="See all assignments"
            >
              {({ pressed }) => (
                <Text className={`text-sm ${pressed ? 'text-white' : 'text-white/70'}`}>
                  See All
                </Text>
              )}
            </Pressable>
          </View>

          <View ref={orderTarget} collapsable={false}>
          {loading ? (
            <View className="items-center justify-center py-16 gap-3">
              <ActivityIndicator size="large" color="#ffffff" />
              <Text className="text-sm text-ink-faint font-medium">Loading your orders…</Text>
            </View>
          ) : current ? (
            <ActiveOrderCard
              booking={current}
              onPress={() => openBooking(current.booking_id)}
            />
          ) : (
            <NoActiveOrder onPress={() => openAssignments('All')} />
          )}
          </View>

          {active.length > 1 && (
            <Pressable
              onPress={() => openAssignments('Active')}
              className="mt-3 items-center rounded-2xl border border-surface-border bg-surface-card py-3"
              accessibilityRole="button"
            >
              <Text className="text-xs font-semibold text-ink-muted">
                +{active.length - 1} more active order{active.length > 2 ? 's' : ''}
              </Text>
            </Pressable>
          )}
        </View>
      </ScrollView>

      {/* Nothing reaches this driver unless they turn themselves on here, so it
          sits under the thumb rather than inside the scroll. A vendor's driver
          is crewed booking by booking and is not in the company pool: no
          calendar, no dock, and no tour step pointing at where it would be. */}
      {!isVendorDriver && (
        <View
          ref={availabilityTarget}
          collapsable={false}
          className="absolute inset-x-0 bottom-0 border-t border-white/[0.06] bg-black px-6 pt-3"
          style={{ paddingBottom: insets.bottom + 12 }}
        >
          <AvailabilityToggle />
        </View>
      )}

      <CoachMarkTour
        tourId="home"
        steps={isVendorDriver ? VENDOR_HOME_TOUR : HOME_TOUR}
        ready={!loading && hasHydrated}
      />
    </View>
  )
}

/* ── Hero ─────────────────────────────────────────────────────────────── */

function HeroCard({ onPress }: { onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel="Check your routes"
      className="h-[158px] rounded-[20px] overflow-hidden bg-black active:opacity-90"
      style={{
        shadowColor:   '#000',
        shadowOffset:  { width: 0, height: 4 },
        shadowOpacity: 0.25,
        shadowRadius:  4,
        elevation:     4,
      }}
    >
      <Image
        source={routeMapImg}
        resizeMode="cover"
        className="absolute inset-0 h-full w-full opacity-50"
      />
      <View className="flex-1 flex-row items-end justify-between p-[13px]">
        <Text
          className="w-[190px] text-[30px] leading-[30px] text-white"
          style={{ fontFamily: FONTS.spartan.black }}
        >
          CHECK YOUR ROUTES
        </Text>
        <ChevronsRight size={24} color="#ffffff" strokeWidth={2} />
      </View>
    </Pressable>
  )
}

function QuickAction({
  icon, label, onPress,
}: { icon: React.ReactNode; label: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      className="h-9 flex-1 flex-row items-center justify-center gap-2 rounded-2xl bg-white active:opacity-80"
    >
      {icon}
      <Text
        className="text-base text-black"
        style={{ fontFamily: FONTS.alegreya.bold }}
      >
        {label}
      </Text>
    </Pressable>
  )
}

/* ── Active order ─────────────────────────────────────────────────────── */

function ActiveOrderCard({
  booking, onPress,
}: { booking: BookingWithRelations; onPress: () => void }) {
  const cfg                  = statusConfigFor(booking, 'assigned')
  const { done, total, pct } = getProgress(booking.booking_destinations)

  const ref = bookingRef(booking)

  const clientUser = booking.clients?.users
  const fullName   = clientUser ? `${clientUser.first_name} ${clientUser.last_name}`.trim() : '—'
  const title      = (booking.clients?.company_name ?? fullName).toUpperCase()

  const stops = [...(booking.booking_destinations ?? [])]
    .sort((a, b) => a.sequence_order - b.sequence_order)

  const shown  = stops.slice(0, ROUTE_PREVIEW_STOPS - 1)
  const hidden = stops.length - shown.length

  const truck      = booking.truck_assignments?.[0]?.trucks
  const truckModel = truck?.truck_models?.name ?? truck?.truck_models?.vehicle_type ?? booking.truck_type_needed
  // A vendor's vehicle is not in the fleet: its plate rides on the delivery.
  const vendorDelivery = (booking as { deliveries?: Array<{ vendor_vehicle_plate?: string | null }> }).deliveries?.[0]
  const plate      = truck?.plate_number ?? vendorDelivery?.vendor_vehicle_plate ?? undefined

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Booking ${ref}, ${title}. Open delivery details.`}
      className="overflow-hidden rounded-[15px] border-[0.5px] border-[#424242] bg-white p-[15px] active:opacity-95"
    >
      {/* ID · date · status */}
      <View className="flex-row items-center justify-between">
        <View className="flex-row items-center gap-2">
          <Text className="text-sm font-medium text-black">{ref}</Text>
          <View className="h-1 w-1 rounded-full bg-[#818181]" />
          <Text className="text-sm font-medium text-[#818181]">
            {formatDate(booking.schedule_date)}
          </Text>
        </View>

        <View
          className="h-[18px] flex-row items-center gap-1 rounded-2xl px-2"
          style={{ backgroundColor: '#003632', borderWidth: 0.4, borderColor: CYAN }}
        >
          <View className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: CYAN }} />
          <Text className="text-xs font-medium" style={{ color: CYAN }}>
            {cfg.label.toUpperCase()}
          </Text>
        </View>
      </View>

      {/* Client · call time */}
      <View className="mt-1.5 flex-row items-center gap-2.5">
        <Text
          className="flex-1 text-[25px] leading-[26px] text-black"
          numberOfLines={1}
          style={{ fontFamily: FONTS.spartan.bold }}
        >
          {title}
        </Text>
        <View
          className="h-[15px] items-center justify-center rounded-2xl px-2.5"
          style={{ backgroundColor: CARD_INK }}
        >
          <Text className="text-xs font-medium text-[#d9d9d9]">
            {formatTime(booking.call_time)}
          </Text>
        </View>
      </View>

      {/* Route */}
      <View className="mt-2.5 gap-2.5 rounded-[10px] p-3" style={{ backgroundColor: CARD_INK }}>
        <RouteRow label={booking.origin} kind="origin" />
        {shown.map((s) => (
          <RouteRow
            key={s.destination_id}
            label={s.address}
            kind={s.status === 'delivered' ? 'done' : 'stop'}
          />
        ))}
        {hidden > 0 && (
          <RouteRow label={`+${hidden} more stop${hidden > 1 ? 's' : ''}`} kind="more" />
        )}
      </View>

      {/* Progress */}
      <View className="mt-3 flex-row items-center gap-2">
        <View className="h-0.5 flex-1 overflow-hidden rounded-full" style={{ backgroundColor: CARD_INK }}>
          <View
            className="h-full rounded-full"
            style={{ backgroundColor: CYAN, width: `${Math.max(pct * 100, total ? 4 : 0)}%` }}
          />
        </View>
        <Text className="w-[30px] text-right text-[10px] leading-[11px] font-medium text-[#818181]">
          {done}/{total}{'\n'}stops
        </Text>
      </View>

      {/* Vehicle · open */}
      <View className="mt-2.5 flex-row items-center gap-2.5">
        <View
          className="h-[22px] flex-1 flex-row items-center gap-2 rounded-[5px] px-3"
          style={{ backgroundColor: CARD_INK }}
        >
          <Image source={truckIconImg} style={{ width: 10, height: 10 }} resizeMode="contain" />
          <Text className="text-xs font-medium text-white" numberOfLines={1}>{truckModel}</Text>
          {!!plate && (
            <>
              <View className="h-1 w-1 rounded-full bg-[#818181]" />
              <Text className="text-xs font-medium text-[#818181]" numberOfLines={1}>{plate}</Text>
            </>
          )}
        </View>

        <View
          className="h-5 w-5 items-center justify-center rounded-full"
          style={{ backgroundColor: CARD_INK }}
        >
          <ChevronRight size={13} color="#ffffff" strokeWidth={2} />
        </View>
      </View>
    </Pressable>
  )
}

function RouteRow({
  label, kind,
}: { label: string; kind: 'origin' | 'stop' | 'done' | 'more' }) {
  return (
    <View className="flex-row items-center gap-2.5">
      <View className="w-1.5 items-center">
        {kind === 'origin' ? (
          <View className="h-1.5 w-1.5 rounded-full border border-white bg-transparent" />
        ) : kind === 'more' ? (
          <View className="h-1.5 w-1.5 rounded-full bg-[#555555]" />
        ) : (
          <View
            className="h-1.5 w-1.5 rounded-full"
            style={{ backgroundColor: kind === 'done' ? '#3af626' : CYAN }}
          />
        )}
      </View>
      <Text
        className={`flex-1 text-xs font-medium ${kind === 'more' ? 'text-[#818181]' : 'text-white'}`}
        numberOfLines={1}
      >
        {label}
      </Text>
    </View>
  )
}

function NoActiveOrder({ onPress }: { onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel="No active orders. Open my assignments."
      className="items-center rounded-[15px] border-[0.5px] border-surface-border bg-surface-card px-6 py-10"
    >
      <PackageOpen size={40} color="#818181" />
      <Text className="mt-3 text-base font-bold text-ink-primary">No active orders</Text>
      <Text className="mt-1 text-center text-sm leading-5 text-ink-faint">
        Nothing is on the road right now. Tap to see everything assigned to you.
      </Text>
    </Pressable>
  )
}
