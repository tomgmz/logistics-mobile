import AsyncStorage from '@react-native-async-storage/async-storage'

const CACHE_VERSION = 1
const CACHE_TTL_MS  = 24 * 60 * 60 * 1_000

const KEY_PREFIX = `nav_route_cache_v${CACHE_VERSION}_`


interface CacheEntry<T> {
  version:  number
  cachedAt: number
  data:     T
}

type CacheReadResult<T> =
  | { hit: true;  data: T;    stale: false }
  | { hit: false; data: null; stale: boolean }


function cacheKey(bookingId: string): string {
  return `${KEY_PREFIX}${bookingId.replace(/[^a-zA-Z0-9_-]/g, '_')}`
}

function isOurKey(key: string): boolean {
  return key.startsWith(KEY_PREFIX)
}

export async function saveRouteCache<T>(bookingId: string, data: T): Promise<void> {
  try {
    const entry: CacheEntry<T> = {
      version:  CACHE_VERSION,
      cachedAt: Date.now(),
      data,
    }
    await AsyncStorage.setItem(cacheKey(bookingId), JSON.stringify(entry))
  } catch {
    
  }
}

export async function loadRouteCache<T>(
  bookingId: string,
): Promise<CacheReadResult<T>> {
  const MISS = (stale: boolean): CacheReadResult<T> => ({ hit: false, data: null, stale })

  try {
    const key = cacheKey(bookingId)
    const raw = await AsyncStorage.getItem(key)
    if (!raw) return MISS(false)

    let entry: CacheEntry<T>
    try {
      entry = JSON.parse(raw) as CacheEntry<T>
    } catch {
      await AsyncStorage.removeItem(key)
      return MISS(false)
    }

    if (entry.version !== CACHE_VERSION) {
      await AsyncStorage.removeItem(key)
      return MISS(true)
    }

    if (Date.now() - entry.cachedAt > CACHE_TTL_MS) {
      await AsyncStorage.removeItem(key)
      return MISS(true)
    }

    return { hit: true, data: entry.data, stale: false }
  } catch {
    return MISS(false)
  }
}

export async function loadRouteCacheData<T>(bookingId: string): Promise<T | null> {
  const result = await loadRouteCache<T>(bookingId)
  return result.hit ? result.data : null
}

export async function clearRouteCache(bookingId: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(cacheKey(bookingId))
  } catch {
    // non-critical
  }
}

export async function listRouteCacheIds(): Promise<string[]> {
  try {
    const allKeys = await AsyncStorage.getAllKeys()
    return allKeys
      .filter(isOurKey)
      .map((k) => k.slice(KEY_PREFIX.length))
  } catch {
    return []
  }
}

export async function pruneExpiredCaches(): Promise<void> {
  try {
    const allKeys = await AsyncStorage.getAllKeys()
    const ourKeys = allKeys.filter(isOurKey)
    if (!ourKeys.length) return

    const pairs = await AsyncStorage.multiGet(ourKeys)
    const toDelete: string[] = []

    for (const [key, raw] of pairs) {
      if (!raw) {
        toDelete.push(key)
        continue
      }
      try {
        const entry = JSON.parse(raw) as CacheEntry<unknown>
        const expired = Date.now() - entry.cachedAt > CACHE_TTL_MS
        const wrongVersion = entry.version !== CACHE_VERSION
        if (expired || wrongVersion) toDelete.push(key)
      } catch {
        toDelete.push(key)
      }
    }

    if (toDelete.length) {
      await AsyncStorage.multiRemove(toDelete)
    }
  } catch {
    // non-critical
  }
}