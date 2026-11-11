import { AppState, Platform, type AppStateStatus } from 'react-native'
import NetInfo from '@react-native-community/netinfo'
import { QueryClient, focusManager, onlineManager } from '@tanstack/react-query'
import { useAuthStore } from '../store/auth.store'

/**
 * The one TanStack Query client for the driver app (same rules as the web,
 * 2026-11-11). Server data lives here; screen state (signed-in user, the
 * availability calendar, open chat) stays in Zustand.
 *
 * - A screen shows what it last had at once and ALWAYS re-reads on open.
 * - Coming back to the app re-reads data older than 30 s; so does getting
 *   signal back (onlineManager follows NetInfo, focusManager follows AppState).
 * - One retry, never for a 4xx.
 * - Unused data is dropped after 30 min; data holding file links is never
 *   shown after 5 min (useApiQuery), since those links expire at 10–15.
 * - Every key starts with the signed-in user, and the whole cache is cleared
 *   when the account changes or the driver signs out.
 *
 * This is the IN-MEMORY layer. What must survive the app being closed in a dead
 * zone (the bookings list, a booking's trips, the booking for navigation, and
 * the offline queue of confirmations) keeps its own AsyncStorage cache
 * (driverBookings, trips, navCache, offlineQueue); those are unchanged.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime:            30_000,
      gcTime:               30 * 60_000,
      refetchOnMount:       'always',
      refetchOnWindowFocus: true,
      refetchOnReconnect:   true,
      // 'always': a request offline fails at once, as it did before, so every
      // screen falls back to its AsyncStorage copy. ('online'/'offlineFirst'
      // would PAUSE the request, or its retry, until signal returns, and the
      // screen would sit loading in a dead zone.) Reconnect still re-reads.
      networkMode:          'always',
      retry: (count, err: any) => {
        const status: number = err?.response?.status ?? 0
        if (status >= 400 && status < 500) return false
        return count < 1
      },
    },
    mutations: { retry: false, networkMode: 'always' },
  },
})

// Online / offline from NetInfo. Only an explicit "not connected" counts as
// offline: isInternetReachable can stay false in the background (see the
// tracking fix of 2026-11-06), which would pause every query.
onlineManager.setEventListener((setOnline) =>
  NetInfo.addEventListener((state) => setOnline(state.isConnected !== false)),
)

// "Window focus" on a phone is the app coming back to the foreground.
if (Platform.OS !== 'web') {
  focusManager.setEventListener((handleFocus) => {
    const sub = AppState.addEventListener('change', (s: AppStateStatus) => handleFocus(s === 'active'))
    return () => sub.remove()
  })
}

/** The signed-in user's id, or null when signed out. */
export function accountScope(): string | null {
  return useAuthStore.getState().user?.user_id ?? null
}

let last = accountScope()
useAuthStore.subscribe(() => {
  const now = accountScope()
  if (now !== last) {
    last = now
    void queryClient.cancelQueries()
    queryClient.clear()
  }
})
