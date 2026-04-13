import { useFonts } from 'expo-font'
import { router, SplashScreen, Stack } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { useEffect } from 'react'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import '../global.css'
import { useAuthStore, useAuthHydrated } from '../lib/store/auth.store'
import { APP_FONTS } from '../lib/config/fonts'

SplashScreen.preventAutoHideAsync()

function getRoleRoute(role: string): string {
  if (role === 'admin') return '/admin'
  if (role === 'assistant_driver') return '/assistant-driver'
  if (role === 'driver') return '/driver'
  return '/(tabs)/'
}

export default function RootLayout() {
  const authReady = useAuthHydrated()
  const user = useAuthStore((s) => s.user)

  const [fontsLoaded, fontError] = useFonts(APP_FONTS)

  useEffect(() => {
    if ((!fontsLoaded && !fontError) || !authReady) return
    SplashScreen.hideAsync()
    if (user) router.replace(getRoleRoute(user.role))
  }, [fontsLoaded, fontError, authReady, user])

  if (!fontsLoaded && !fontError) return null
  if (!authReady) return null

  return (
    <SafeAreaProvider style={{ flex: 1, backgroundColor: '#080808' }}>
      <StatusBar style="light" /> 
      <Stack
        screenOptions={{
          headerShown:     false,
          contentStyle:    { backgroundColor: '#080808' },
        }}
      />
    </SafeAreaProvider>
  )
}