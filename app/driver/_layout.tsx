import { Slot, router } from 'expo-router'
import { View, StyleSheet } from 'react-native'
import { usePathname } from 'expo-router'
import { useEffect } from 'react'
import DriverTopBar from '../../components/ui/DriverTopBar'
import { useAuthStore, useAuthHydrated } from '../../lib/store/auth.store'
import { useMessagingBadgeSync } from '../../hooks/useMessagingBadgeSync'
import { useGlobalPresence } from '../../hooks/useGlobalPresence'
import { useNotificationsRealtime } from '../../hooks/useNotificationsRealtime'
import { startAutoFlush, flushOnAppForeground } from '../../lib/offlineQueue'
// Imported for its side effect: defining the background location task at module
// scope. The OS can invoke that task before any screen has mounted — including
// in a fresh JS context after the app was evicted — so the definition has to be
// reached by simply loading the driver area, not by rendering the nav map.
import '../../lib/locationTracking'

export default function DriverLayout() {
  const pathname = usePathname()
  const currentUserId = useAuthStore(s => s.user?.user_id ?? '')

  /**
   * Nothing but a signed-in driver gets past here.
   *
   * The role check at sign-in only decides where to send someone once; it does
   * not stop this area being reached with no session at all — after a sign-out,
   * or on a launch where the stored session failed to come back. Without this,
   * those cases landed on the assignments screen, which read the missing
   * driver_id and reported it as "not logged in as a driver": true, but not
   * something the driver can act on, and it hid the fact they simply needed to
   * sign in again.
   */
  const hydrated = useAuthHydrated()
  const role     = useAuthStore(s => s.user?.role ?? null)
  const signedIn = useAuthStore(s => !!s.user)

  useEffect(() => {
    if (!hydrated) return
    if (!signedIn || role !== 'driver') router.replace('/sign-in')
  }, [hydrated, signedIn, role])

  // Render nothing while that redirect is on its way, so no driver screen ever
  // mounts against a session it can't use.
  const blocked = hydrated && (!signedIn || role !== 'driver')

  useMessagingBadgeSync(currentUserId)

  useGlobalPresence(currentUserId)

  useNotificationsRealtime(currentUserId)

  // Drain any queued offline status updates (arrivals confirmed in a dead zone)
  // on reconnect and on app foreground, even after the nav screen has unmounted.
  useEffect(() => {
    const stopNet = startAutoFlush()
    const stopApp = flushOnAppForeground()
    return () => { stopNet(); stopApp() }
  }, [])

  // These screens are full-bleed and bring their own headers.
  const hideChrome =
    pathname.startsWith('/driver/maps') ||
    pathname.startsWith('/driver/messages') ||
    pathname.startsWith('/driver/notifications') ||
    // The reports LIST keeps the bar (it is a tab like any other); the form and
    // a single report bring their own header with a back arrow, because they
    // are entered from a modal and need a way out that is not the tab bar.
    /^\/driver\/reports\/./.test(pathname)

  if (blocked) return <View style={styles.root} />

  if (hideChrome) {
    return <Slot />
  }

  return (
    <View style={styles.root}>
      <DriverTopBar />
      <View style={styles.main}>
        <Slot />
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  root: {
    flex:            1,
    backgroundColor: '#000000',
  },
  main: {
    flex: 1,
  },
})
