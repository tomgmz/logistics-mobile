import { useFonts } from 'expo-font'
import { SplashScreen, Stack, router, usePathname } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { useEffect } from 'react'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
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

  useEffect(() => {
    setSessionExpiredHandler(() => {
      clearUser()
      router.replace('/sign-in')
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

  useEffect(() => {
    if (!isReady) return
    SplashScreen.hideAsync()
  }, [isReady])

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
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
    </GestureHandlerRootView>
  )
}