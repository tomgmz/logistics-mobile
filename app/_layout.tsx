import { useFonts } from 'expo-font'
import { SplashScreen, Stack, router, usePathname } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { useEffect } from 'react'
import { Alert } from 'react-native'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { KeyboardProvider } from 'react-native-keyboard-controller'
import '../global.css'
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClient } from '../lib/query/client'
import { useAuthStore, useAuthHydrated } from '../lib/store/auth.store'
import { getMe, setSessionExpiredHandler, TokenStore } from '../lib/api/auth.api'
import { APP_FONTS } from '../lib/config/fonts'
import { syncServerTime } from '../lib/serverTime'
import { registerForPushNotifications, initPushResponders, ensureNotificationChannels } from '../lib/push'
import { flush } from '../lib/offlineQueue'
import { configureNetwork } from '../lib/network'
import { warnIfUnsupportedDevice } from '../lib/deviceSupport'

SplashScreen.preventAutoHideAsync()
// Online = our server answers, on Wi-Fi or mobile data alike (lib/network).
configureNetwork()

export default function RootLayout() {
  const authReady = useAuthHydrated()
  const user      = useAuthStore((s) => s.user)
  const setUser   = useAuthStore((s) => s.setUser)
  const clearUser = useAuthStore((s) => s.clearUser)

  const [fontsLoaded, fontError] = useFonts(APP_FONTS)
  const isReady = (fontsLoaded || !!fontError) && authReady

  // Once per phone: warn when it can't run navigation/maps/push properly.
  useEffect(() => { if (isReady) void warnIfUnsupportedDevice() }, [isReady])

  useEffect(() => {
    setSessionExpiredHandler((reason) => {
      clearUser()
      router.replace('/sign-in')
      // Say why, when the server did (e.g. a vendor driver's last booking closed).
      if (reason) {
        const title = reason.code === 'NO_ACTIVE_ASSIGNMENT' ? 'No delivery assigned' : 'Signed out'
        Alert.alert(title, reason.message)
      }
    })
  }, [])

  const pathname = usePathname()

  useEffect(() => {
    if (!authReady) return

    const { accessToken, refreshToken } = useAuthStore.getState()

    if (accessToken)  TokenStore.setAccess(accessToken)
    if (refreshToken) TokenStore.setRefresh(refreshToken)

    if (!user) return

    getMe()
      .then(setUser)
      .catch(() => {
      })
  }, [authReady])

  useEffect(() => {
    if (!isReady || !user || !user.must_change_password) return
    if (pathname === '/change-password') return
    router.replace('/change-password')
  }, [isReady, pathname, user])

  // Register for push notifications once signed in; wire tap handling once.
  useEffect(() => {
    if (!authReady || !user) return
    registerForPushNotifications()
  }, [authReady, user?.user_id])

  useEffect(() => {
    // Channels first, signed in or not, so a push never lands on a silent fallback channel.
    void ensureNotificationChannels()
    const cleanup = initPushResponders()
    return cleanup
  }, [])

  // A driver signing in may have work queued from an earlier session on this
  // phone (entries are held for their owner across sign-outs); send it now.
  useEffect(() => {
    if (!authReady || !user) return
    void flush().catch(() => {})
  }, [authReady, user?.user_id])

  // Date-gated work (can this booking be started yet?) must not trust the
  // device clock, so learn the server's offset as soon as we're signed in.
  useEffect(() => {
    if (!authReady || !user) return
    void syncServerTime()
  }, [authReady, user?.user_id])

  useEffect(() => {
    if (!isReady) return
    SplashScreen.hideAsync()
  }, [isReady])

  return (
    <QueryClientProvider client={queryClient}>
    <GestureHandlerRootView style={{ flex: 1 }}>
      <KeyboardProvider>
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
      </KeyboardProvider>
    </GestureHandlerRootView>
    </QueryClientProvider>
  )
}