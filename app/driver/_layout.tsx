import { Slot } from 'expo-router'
import { View, StyleSheet } from 'react-native'
import { usePathname } from 'expo-router'
import { useEffect } from 'react'
import DriverTopBar from '../../components/ui/DriverTopBar'
import { useAuthStore } from '../../lib/store/auth.store'
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
    pathname.startsWith('/driver/notifications')

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
