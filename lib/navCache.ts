import AsyncStorage from '@react-native-async-storage/async-storage'

/**
 * Lightweight cache of the raw GET /booking/:id payload, so navigation can
 * derive its waypoints/markers when the network is flaky or briefly down at
 * start. Deliberately AsyncStorage-only and kept out of the Mapbox cache
 * (components/maps/mapbox/cache.ts), which
 * pulls in @rnmapbox/maps — nothing here should drag the Mapbox native module
 * into the Google navigation path.
 *
 * This does NOT make navigation work fully offline: the Google SDK still needs
 * the network to compute a route. It only removes the booking fetch as a hard
 * blocker and lets details render from the last known state.
 */

const bookingCacheKey = (bookingId: string) => `nav_booking_cache_${bookingId}`

export async function saveBookingCache(bookingId: string, data: unknown): Promise<void> {
  try {
    await AsyncStorage.setItem(bookingCacheKey(bookingId), JSON.stringify(data))
  } catch { /* non-critical */ }
}

export async function loadBookingCache<T = any>(bookingId: string): Promise<T | null> {
  try {
    const raw = await AsyncStorage.getItem(bookingCacheKey(bookingId))
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}

export async function clearBookingCache(bookingId: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(bookingCacheKey(bookingId))
  } catch { /* non-critical */ }
}
