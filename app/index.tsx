import { useEffect, useState } from 'react'
import { router } from 'expo-router'
import SignInScreen from '../components/SignIn'
import SplashScreen from '../components/SplashScreen'
import Onboarding, { hasSeenOnboarding } from '../components/Onboarding'
import { useAuthStore, useAuthHydrated } from '../lib/store/auth.store'

function getRoleRoute(role: string): string {
  if (role === 'admin') return '/admin'
  if (role === 'assistant_driver') return '/assistant-driver'
  if (role === 'driver') return '/driver'
  return '/(tabs)/'
}

export default function Index() {
  const [splashDone, setSplashDone] = useState(false)
  // null until storage answers; read during the splash so it never adds a wait.
  const [introDone, setIntroDone] = useState<boolean | null>(null)
  const authReady = useAuthHydrated()
  const user = useAuthStore((s) => s.user)

  useEffect(() => {
    hasSeenOnboarding().then(setIntroDone)
  }, [])

  useEffect(() => {
    if (!splashDone || !authReady || !introDone) return
    if (user) router.replace(getRoleRoute(user.role))
  }, [splashDone, authReady, introDone, user])

  if (!splashDone || introDone === null) {
    return <SplashScreen onFinish={() => setSplashDone(true)} />
  }

  if (!introDone) {
    return <Onboarding onFinish={() => setIntroDone(true)} />
  }

  return <SignInScreen />
}