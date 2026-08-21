import AsyncStorage from '@react-native-async-storage/async-storage'
import MapboxGL      from '@rnmapbox/maps'

import type { BookingRoute, LatLng } from '../../../types/navigation.types'
import { MAPBOX_STYLE }              from './style'

const STOP_RADIUS_DEG = 0.045

const MIN_ZOOM = 10
const MAX_ZOOM = 16

const PACK_LIMIT_SOFT = 700

const PACK_REGISTRY_KEY = 'nav_offline_pack_registry'

const routeCacheKey = (id: string) => `nav_route_cache_${id}`

const stopPackName = (bookingId: string, stopKey: string) =>
  `trip_${bookingId}_stop_${stopKey}`

const overviewPackName = (bookingId: string) => `trip_${bookingId}_overview`

async function readRegistry(): Promise<Record<string, number>> {
  try {
    const raw = await AsyncStorage.getItem(PACK_REGISTRY_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

async function writeRegistry(registry: Record<string, number>): Promise<void> {
  try {
    await AsyncStorage.setItem(PACK_REGISTRY_KEY, JSON.stringify(registry))
  } catch { /* non-critical */ }
}

async function registerPack(name: string): Promise<void> {
  const registry = await readRegistry()
  registry[name] = Date.now()
  await writeRegistry(registry)
}

async function unregisterPack(name: string): Promise<void> {
  const registry = await readRegistry()
  delete registry[name]
  await writeRegistry(registry)
}


async function evictOldPacksIfNeeded(): Promise<void> {
  try {
    const existingPacks = await MapboxGL.offlineManager.getPacks()
    if (existingPacks.length < PACK_LIMIT_SOFT) return

    const registry = await readRegistry()

    const sorted = Object.entries(registry).sort(([, a], [, b]) => a - b)

    const toEvict = existingPacks.length - PACK_LIMIT_SOFT + 50
    let evicted   = 0

    for (const [name] of sorted) {
      if (evicted >= toEvict) break
      try {
        await MapboxGL.offlineManager.deletePack(name)
        await unregisterPack(name)
        evicted++
        console.log(`[offline] evicted old pack: ${name}`)
      } catch {
        await unregisterPack(name)
      }
    }
  } catch (err) {
    console.warn('[offline] eviction failed:', err)
  }
}


async function ensureStopPack(
  packName: string,
  center:   LatLng,
): Promise<void> {
  const existingPacks = await MapboxGL.offlineManager.getPacks()
  if (existingPacks.some((p) => p.name === packName)) {
    await registerPack(packName)
    return
  }

  const ne: [number, number] = [
    center.longitude + STOP_RADIUS_DEG,
    center.latitude  + STOP_RADIUS_DEG,
  ]
  const sw: [number, number] = [
    center.longitude - STOP_RADIUS_DEG,
    center.latitude  - STOP_RADIUS_DEG,
  ]

  await MapboxGL.offlineManager.createPack(
    {
      name:     packName,
      styleURL: MAPBOX_STYLE,
      minZoom:  MIN_ZOOM,
      maxZoom:  MAX_ZOOM,
      bounds:   [ne, sw],
    },
    (_region, status) => {
      if (__DEV__) console.log(`[offline] ${packName} progress:`, status?.percentage?.toFixed(0) + '%')
    },
    (_region, err) => {
      console.warn(`[offline] ${packName} error:`, err)
    },
  )

  await registerPack(packName)
}

async function ensureOverviewPack(
  bookingId: string,
  points:    LatLng[],
): Promise<void> {
  const name = overviewPackName(bookingId)

  const existingPacks = await MapboxGL.offlineManager.getPacks()
  if (existingPacks.some((p) => p.name === name)) {
    await registerPack(name)
    return
  }

  const lngs = points.map((p) => p.longitude)
  const lats  = points.map((p) => p.latitude)

  const PAD = 0.05
  const ne: [number, number] = [Math.max(...lngs) + PAD, Math.max(...lats) + PAD]
  const sw: [number, number] = [Math.min(...lngs) - PAD, Math.min(...lats) - PAD]

  await MapboxGL.offlineManager.createPack(
    {
      name,
      styleURL: MAPBOX_STYLE,
      minZoom:  0,
      maxZoom:  10,
      bounds:   [ne, sw],
    },
    (_region, status) => {
      if (__DEV__) console.log(`[offline] overview progress:`, status?.percentage?.toFixed(0) + '%')
    },
    (_region, err) => {
      console.warn('[offline] overview pack error:', err)
    },
  )

  await registerPack(name)
}

export async function saveRouteCache(bookingId: string, data: BookingRoute): Promise<void> {
  try {
    await AsyncStorage.setItem(routeCacheKey(bookingId), JSON.stringify(data))
  } catch { /* non-critical */ }
}

export async function loadRouteCache(bookingId: string): Promise<BookingRoute | null> {
  try {
    const raw = await AsyncStorage.getItem(routeCacheKey(bookingId))
    return raw ? (JSON.parse(raw) as BookingRoute) : null
  } catch {
    return null
  }
}

export async function ensureOfflinePack(
  bookingId: string,
  origin:    LatLng,
  stops:     LatLng[],
  allPoints: LatLng[],
): Promise<void> {
  try {
    await evictOldPacksIfNeeded()

    const downloads: Promise<void>[] = []

    downloads.push(
      ensureStopPack(stopPackName(bookingId, 'origin'), origin)
        .catch((e) => console.warn('[offline] origin pack failed:', e))
    )

    // Each dropoff stop
    stops.forEach((stop, i) => {
      downloads.push(
        ensureStopPack(stopPackName(bookingId, `stop_${i}`), stop)
          .catch((e) => console.warn(`[offline] stop_${i} pack failed:`, e))
      )
    })

    downloads.push(
      ensureOverviewPack(bookingId, allPoints)
        .catch((e) => console.warn('[offline] overview pack failed:', e))
    )

    await Promise.all(downloads)

    if (__DEV__) {
      console.log(`[offline] ensureOfflinePack complete for ${bookingId}: ${downloads.length} packs`)
    }
  } catch (err) {
    console.warn('[offline] ensureOfflinePack failed:', err)
  }
}

export async function cleanupTripPacks(
  bookingId: string,
  stopCount: number,
): Promise<void> {
  const names = [
    overviewPackName(bookingId),
    stopPackName(bookingId, 'origin'),
    ...Array.from({ length: stopCount }, (_, i) => stopPackName(bookingId, `stop_${i}`)),
  ]

  await Promise.all(
    names.map(async (name) => {
      try {
        await MapboxGL.offlineManager.deletePack(name)
        await unregisterPack(name)
        if (__DEV__) console.log(`[offline] cleaned up pack: ${name}`)
      } catch {
        await unregisterPack(name)
      }
    })
  )
}