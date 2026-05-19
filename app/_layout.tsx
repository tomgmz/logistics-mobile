import { useFonts } from 'expo-font'
import { SplashScreen, Stack, router, usePathname } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { useEffect } from 'react'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import '../global.css'
import { useAuthStore, useAuthHydrated } from '../lib/store/auth.store'
import { getMe, setSessionExpiredHandler, TokenStore } from '../lib/api/auth.api'
import { APP_FONTS } from '../lib/config/fonts'

SplashScreen.preventAutoHideAsync()

export default function RootLayout() {
  const authReady = useAuthHydrated()
  const user      = useAuthStore((s) => s.user)
  const setUser   = useAuthStore((s) => s.setUser)
  const clearUser = useAuthStore((s) => s.clearUser)

  const [fontsLoaded, fontError] = useFonts(APP_FONTS)
  const isReady = (fontsLoaded || !!fontError) && authReady

  // Register session-expired handler once on mount so the axios interceptor
  // can trigger a clean logout when the refresh token itself is invalid.
  useEffect(() => {
    setSessionExpiredHandler(() => {
      clearUser()
      router.replace('/sign-in')
    })
  }, [])

  // Once the Zustand store has rehydrated from SecureStore, sync the tokens
  // into TokenStore so the axios interceptor can find them on a cold start,
  // then refresh the user object to populate nested relations (drivers, etc).
  const pathname = usePathname()

  useEffect(() => {
    if (!authReady) return

    const { accessToken, refreshToken } = useAuthStore.getState()

    // Sync Zustand-persisted tokens → TokenStore (axios interceptor reads here)
    if (accessToken)  TokenStore.setAccess(accessToken)
    if (refreshToken) TokenStore.setRefresh(refreshToken)

    if (!user) return

    getMe()
      .then(setUser)
      .catch(() => {
        // Network errors / timeouts should NOT log the user out.
        // True 401s are handled by the axios interceptor via
        // setSessionExpiredHandler above.
      })
  }, [authReady])

  useEffect(() => {
    if (!isReady || !user || !user.must_change_password) return
    if (pathname === '/change-password') return
    router.replace('/change-password')
  }, [isReady, pathname, user])

  useEffect(() => {
    if (!isReady) return
    SplashScreen.hideAsync()
  }, [isReady])

  return (
    <SafeAreaProvider style={{ flex: 1, backgroundColor: '#080808' }}>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerShown:  false,
          contentStyle: { backgroundColor: '#080808' },
          animation:    'none',
        }}
      />
    </SafeAreaProvider>
  )
}