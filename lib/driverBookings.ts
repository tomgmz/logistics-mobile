/**
 * Everything both driver-facing booking screens need: the shapes the API
 * returns, the offline cache they share, and the small formatters that turn a
 * booking into the strings the cards show.
 *
 * The home screen and the assignments list read the SAME cache key, so whichever
 * one the driver opens first warms the other — landing on home after sign-in
 * means the assignments list is already populated when they tap through.
 */
import AsyncStorage from '@react-native-async-storage/async-storage'
import api from './api/auth.api'
import { cachedData, cachedFetch } from './query/useApiQuery'
import { qk } from './query/keys'
import { BOOKING_STATUS_COLOR, RETURN_COLOR } from './statusColors'

export interface BookingDestination {
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

export interface TruckModel {
  model_id:     string
  name:         string
  vehicle_type: string
  image_url:    string | null
}

export interface TruckAssignment {
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

export interface BookingClient {
  client_id:       string
  company_name:    string | null
  billing_address: string | null
  users: {
    first_name: string
    last_name:  string
    email:      string
    phone:      string | null
  }
}

export interface BookingWithRelations {
  booking_id:          string
  client_id:           string
  origin:              string
  origin_latitude:     number | null
  origin_longitude:    number | null
  truck_type_needed:   string
  schedule_date:       string
  call_time:           string
  /** When operations wants the driver at the pickup point; null = call_time. */
  driver_call_time?:   string | null
  /** Its day (booking day or the day before); null = the booking day. */
  driver_call_date?:   string | null
  // 'delivered': every drop-off done, waiting on the client to confirm completion.
  status:              'pending' | 'assigned' | 'in_transit' | 'delivered' | 'completed' | 'failed' | 'cancelled'
  /** Set once the driver confirmed the vehicle was back in the company lot.
   *  The booking is only truly finished when this is non-null. */
  fleet_return_at:     string | null
  estimated_delivery:  string | null
  required_volume_cbm: number | null
  required_weight_kg:  number | null
  required_length_cm:  number | null
  stackable_required:  boolean | null
  created_at:          string
  updated_at:          string
  // The booking number people actually quote. Server-assigned, so it can be
  // absent on rows created before it existed — see bookingRef().
  reference_number:    string | null
  clients:             BookingClient
  booking_destinations: BookingDestination[]
  truck_assignments:   TruckAssignment[]
}

export interface CachePayload {
  bookings: BookingWithRelations[]
  savedAt:  string
}

export type StatusKey = BookingWithRelations['status']

/**
 * Label + colour of the status pill (components/ui/StatusPill). Colours are the
 * web's (lib/statusColors.ts). Plain colours, not NativeWind classes: Tailwind
 * does not scan lib/, so arbitrary classes written here were never generated
 * (Assigned showed no colour at all, 2026-11-29).
 */
export const STATUS_CONFIG: Record<StatusKey, { label: string; color: string }> = {
  // A driver only sees bookings they are assigned to, so a booking the office
  // still has as Pending reads Assigned in the app (user 2026-11-28).
  pending:    { label: 'Assigned',   color: BOOKING_STATUS_COLOR.assigned },
  assigned:   { label: 'Assigned',   color: BOOKING_STATUS_COLOR.assigned },
  in_transit: { label: 'In Transit', color: BOOKING_STATUS_COLOR.in_transit },
  delivered:  { label: 'Delivered',  color: BOOKING_STATUS_COLOR.delivered },
  completed:  { label: 'Completed',  color: BOOKING_STATUS_COLOR.completed },
  // No drop-off delivered (stolen truck, accident…), 2026-11-14.
  failed:     { label: 'Failed',     color: BOOKING_STATUS_COLOR.failed },
  cancelled:  { label: 'Cancelled',  color: BOOKING_STATUS_COLOR.cancelled },
}

/**
 * Every drop-off is done but the driver has not yet confirmed the vehicle is
 * back in the parking lot. The job is not over for the driver — the return
 * confirmation is still owed — so it stays an active order until then.
 */
export function awaitingFleetReturn(b: BookingWithRelations): boolean {
  return (b.status === 'delivered' || b.status === 'completed' || b.status === 'failed') && !b.fleet_return_at
}

const RETURNING_CONFIG = {
  label: 'Return', color: RETURN_COLOR,
}

/** Badge for a booking, telling a delivered-but-not-returned job apart from a finished one. */
export function statusConfigFor(b: BookingWithRelations, fallback: StatusKey = 'pending') {
  if (awaitingFleetReturn(b)) return RETURNING_CONFIG
  return STATUS_CONFIG[b.status] ?? STATUS_CONFIG[fallback]
}

export function cacheKey(driverId: string) {
  return `bookings_driver_${driverId}`
}

export async function readCache(driverId: string): Promise<CachePayload | null> {
  try {
    const raw = await AsyncStorage.getItem(cacheKey(driverId))
    if (!raw) return null
    return JSON.parse(raw) as CachePayload
  } catch {
    return null
  }
}

export async function writeCache(driverId: string, bookings: BookingWithRelations[]) {
  try {
    const payload: CachePayload = { bookings, savedAt: new Date().toISOString() }
    await AsyncStorage.setItem(cacheKey(driverId), JSON.stringify(payload))
  } catch {
    // non-fatal
  }
}

/** The driver's bookings. Kept in the shared query cache (home and My Assignments share one request). */
export async function fetchDriverBookings(driverId: string): Promise<BookingWithRelations[]> {
  return cachedFetch(qk.driverBookings(driverId), async () => {
    const { data } = await api.get(`/booking/driver/${driverId}`)
    return (data.data ?? []) as BookingWithRelations[]
  })
}

/** The last bookings list held in memory this session, if any (shown before AsyncStorage). */
export function memoryDriverBookings(driverId: string): BookingWithRelations[] | undefined {
  return cachedData<BookingWithRelations[]>(qk.driverBookings(driverId))
}

/**
 * GET /booking/:id, the whole response body ({ status, data }). Kept in the
 * shared query cache, so the booking screen, route preview, navigation and the
 * report form opened one after another share it; every call still asks the
 * server (errors reach the caller as before, so offline fallbacks still run).
 */
export async function fetchBookingBody(bookingId: string): Promise<any> {
  return cachedFetch(qk.booking(bookingId), async () => {
    const { data } = await api.get(`/booking/${bookingId}`)
    return data
  })
}

/** The last GET /booking/:id body held in memory this session, if any. */
export function memoryBookingBody(bookingId: string): any | undefined {
  return cachedData<any>(qk.booking(bookingId))
}

/**
 * The booking number to show the driver.
 *
 * `reference_number` IS the booking number — the one operations, the client and
 * the paperwork all use. Only when a row predates it (or it somehow came back
 * blank) do we fall back to a slice of the UUID, marked with a `#` so nobody
 * mistakes an internal id for a real reference. Same rule the server uses for
 * notification titles and the web app uses for its booking lists.
 */
export function bookingRef(
  booking: { reference_number?: string | null; booking_id: string },
): string {
  const ref = booking.reference_number
  if (typeof ref === 'string' && ref.trim() !== '') return ref.trim()
  return `#${booking.booking_id.slice(0, 8).toUpperCase()}`
}

export function formatCacheAge(savedAt: string): string {
  const diffMs  = Date.now() - new Date(savedAt).getTime()
  const diffMin = Math.floor(diffMs / 60_000)
  if (diffMin < 1)  return 'just now'
  if (diffMin < 60) return `${diffMin}m ago`
  const diffH = Math.floor(diffMin / 60)
  if (diffH < 24)   return `${diffH}h ago`
  return `${Math.floor(diffH / 24)}d ago`
}

export function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-PH', {
    month: 'short', day: 'numeric', year: 'numeric',
  })
}

export function formatTime(timeStr: string): string {
  const [h, m] = timeStr.split(':')
  const hour   = parseInt(h, 10)
  return `${hour % 12 || 12}:${m} ${hour >= 12 ? 'PM' : 'AM'}`
}

export function getProgress(destinations: BookingDestination[]) {
  const done  = destinations.filter((d) => d.status === 'delivered').length
  const total = destinations.length
  return { done, total, pct: total ? done / total : 0 }
}

export function resolveTruckLabel(
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

export const FILTERS = ['All', 'Active', 'Assigned', 'Completed'] as const
export type FilterKey = typeof FILTERS[number]

export function isFilterKey(value: unknown): value is FilterKey {
  return typeof value === 'string' && (FILTERS as readonly string[]).includes(value)
}

export function filterBookings(bookings: BookingWithRelations[], filter: FilterKey) {
  switch (filter) {
    case 'Active':    return bookings.filter((b) => b.status === 'in_transit' || b.status === 'assigned' || awaitingFleetReturn(b))
    // Not started yet. The office's Pending shows as Assigned in the app.
    case 'Assigned':  return bookings.filter((b) => b.status === 'pending' || b.status === 'assigned')
    case 'Completed': return bookings.filter((b) => ((b.status === 'delivered' || b.status === 'completed' || b.status === 'failed') && !awaitingFleetReturn(b)) || b.status === 'cancelled')
    default:          return bookings
  }
}
