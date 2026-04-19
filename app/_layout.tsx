import { useFonts } from 'expo-font'
import { SplashScreen, Stack } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { useEffect } from 'react'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import '../global.css'
import { useAuthHydrated } from '../lib/store/auth.store'
import { APP_FONTS } from '../lib/config/fonts'

SplashScreen.preventAutoHideAsync()

export default function RootLayout() {
  const authReady = useAuthHydrated()
  const [fontsLoaded, fontError] = useFonts(APP_FONTS)

  const isReady = (fontsLoaded || !!fontError) && authReady

  useEffect(() => {
    if (!isReady) return
    SplashScreen.hideAsync()
  }, [isReady])

  return (
    <SafeAreaProvider style={{ flex: 1, backgroundColor: '#080808' }}>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: '#080808' },
          animation: 'none',
        }}
      />
    </SafeAreaProvider>
  )
}