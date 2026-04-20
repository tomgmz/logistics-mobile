import { useEffect, useState } from 'react'
import { router } from 'expo-router'
import SignInScreen from '../components/SignIn'
import SplashScreen from '../components/SplashScreen'
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
    return <SplashScreen onFinish={() => setSplashDone(true)} />
  }

  return <SignInScreen />
}