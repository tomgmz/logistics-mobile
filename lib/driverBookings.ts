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
  payment_terms:   number
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

export const STATUS_CONFIG: Record<StatusKey, {
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

export async function fetchDriverBookings(driverId: string): Promise<BookingWithRelations[]> {
  const { data } = await api.get(`/booking/driver/${driverId}`)
  return data.data ?? []
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

export const FILTERS = ['All', 'Active', 'Pending', 'Completed'] as const
export type FilterKey = typeof FILTERS[number]

export function isFilterKey(value: unknown): value is FilterKey {
  return typeof value === 'string' && (FILTERS as readonly string[]).includes(value)
}

export function filterBookings(bookings: BookingWithRelations[], filter: FilterKey) {
  switch (filter) {
    case 'Active':    return bookings.filter((b) => b.status === 'in_transit' || b.status === 'assigned')
    case 'Pending':   return bookings.filter((b) => b.status === 'pending')
    case 'Completed': return bookings.filter((b) => b.status === 'completed'  || b.status === 'cancelled')
    default:          return bookings
  }
}
