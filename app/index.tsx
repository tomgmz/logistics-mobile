import { useEffect, useState } from 'react'
import { router } from 'expo-router'
import AppSplashScreen from './components/SplashScreen'
import SignInScreen from './components/SignIn'
import { useAuthStore, useAuthHydrated } from '../lib/store/auth.store'

function getRoleRoute(role: string): string {
  if (role === 'admin') return '/admin'
  if (role === 'assistant_driver') return '/assistant-driver'
  if (role === 'driver') return '/driver'
  return '/(tabs)/'
}

export default function Index() {
  const [splashDone, setSplashDone] = useState(false)
  const authReady = useAuthHydrated()
  const user = useAuthStore((s) => s.user)

  useEffect(() => {
    if (!splashDone || !authReady) return
    if (user) router.replace(getRoleRoute(user.role))
  }, [splashDone, authReady, user])

  if (!splashDone) {
    return <AppSplashScreen onFinish={() => setSplashDone(true)} />
  }

  return <SignInScreen />
}