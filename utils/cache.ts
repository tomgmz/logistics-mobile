import AsyncStorage from '@react-native-async-storage/async-storage'
import MapboxGL from '@rnmapbox/maps'

import type { BookingRoute, LatLng } from '../types/navigation.types'
import { getBounds } from './geo'
import { MAPBOX_STYLE } from '../theme/navigation.theme'

const routeCacheKey = (id: string) => `nav_route_cache_${id}`

export async function saveRouteCache(bookingId: string, data: BookingRoute): Promise<void> {
  try {
    await AsyncStorage.setItem(routeCacheKey(bookingId), JSON.stringify(data))
  } catch {
    /* non-critical */
  }
}

export async function loadRouteCache(bookingId: string): Promise<BookingRoute | null> {
  try {
    const raw = await AsyncStorage.getItem(routeCacheKey(bookingId))
    return raw ? (JSON.parse(raw) as BookingRoute) : null
  } catch {
    return null
  }
}

export async function ensureOfflinePack(bookingId: string, points: LatLng[]): Promise<void> {
  try {
    const name  = `trip_${bookingId}`
    const packs = await MapboxGL.offlineManager.getPacks()
    if (packs.some((p) => p.name === name)) return

    const [ne, sw] = getBounds(points)
    await MapboxGL.offlineManager.createPack(
      {
        name,
        styleURL: MAPBOX_STYLE,
        minZoom:  10,
        maxZoom:  16,
        bounds:   [ne, sw],
      },
      (_region, status) => {
        if (__DEV__) console.log('[offline] tile pack progress:', status?.percentage)
      },
      (_region, err) => {
        console.warn('[offline] tile pack error:', err)
      },
    )
  } catch (err) {
    // Non-critical
    console.warn('[offline] ensureOfflinePack failed:', err)
  }
}