import NetInfo, { type NetInfoState } from '@react-native-community/netinfo'

/**
 * One answer to "is this phone online?", used everywhere the app decides
 * whether to send, show the offline banner, or retry.
 *
 * Online means OUR SERVER is reachable — not that some network is up. On mobile
 * data especially, a phone can hold a carrier/IMS (Wi-Fi calling) link that
 * reads as "connected" with no data at all: no load, no balance, one bar in a
 * dead zone. Judged by `isConnected` alone, the app thought it was online,
 * skipped the offline banner and fired requests into nothing.
 *
 * So reachability is tested against the API's own /health endpoint (configured
 * once at start-up, below), on Wi-Fi and mobile data alike. `isInternetReachable`
 * is null while the first test is still running, which counts as online — the
 * request that follows will tell the truth soon enough.
 */

const API_BASE = (process.env.EXPO_PUBLIC_API_URL ?? '').replace(/\/$/, '')

export function isOnline(state: Pick<NetInfoState, 'isConnected' | 'isInternetReachable'> | null | undefined): boolean {
  if (!state) return false
  return !!state.isConnected && state.isInternetReachable !== false
}

let configured = false

/** Point NetInfo's reachability test at our server. Call once at start-up. */
export function configureNetwork(): void {
  if (configured || !API_BASE) return
  configured = true
  NetInfo.configure({
    reachabilityUrl:          `${API_BASE}/health`,
    reachabilityTest:         async (response) => response.status === 200,
    // Re-checked every 5 s while offline (to notice the return fast), every
    // 30 s while online (to notice a silent loss of data without draining it).
    reachabilityShortTimeout: 5_000,
    reachabilityLongTimeout:  30_000,
    reachabilityRequestTimeout: 8_000,
  })
}

/** A 5-second look at /health: is there a working path to the server right now? */
export async function serverReachable(): Promise<boolean> {
  if (!API_BASE) return true
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), 5_000)
  try {
    const res = await fetch(`${API_BASE}/health`, { signal: ctrl.signal })
    return res.ok
  } catch {
    return false
  } finally {
    clearTimeout(t)
  }
}
