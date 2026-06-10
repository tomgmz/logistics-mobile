import ReusableDashboardShell from '../../components/ui/ReusableDashboardShell'
import { Slot } from 'expo-router'
import { Toolbox, ClipboardList } from 'lucide-react-native'
import { usePathname } from 'expo-router'
import { useEffect } from 'react'
import { useAuthStore } from '../../lib/store/auth.store'
import { useMessagingBadgeSync } from '../../hooks/useMessagingBadgeSync'
import { useGlobalPresence } from '../../hooks/useGlobalPresence'
import { startAutoFlush, flushOnAppForeground } from '../../lib/offlineQueue'

const DRIVER_NAV = [
  {
    href:  '/driver/driver-assignment',
    label: 'Driver Assignment',
    icon:  <ClipboardList size={17} color="rgba(255,255,255,0.40)" />,
  },
  {
    href:  '/driver/maintenance',
    label: 'Maintenance',
    icon:  <Toolbox size={17} color="rgba(255,255,255,0.40)" />,
  },
]

export default function DriverLayout() {
  const pathname = usePathname()
  const currentUserId = useAuthStore(s => s.user?.user_id ?? '')

  useMessagingBadgeSync(currentUserId)

  useGlobalPresence(currentUserId)

  // Drain any queued offline status updates (arrivals confirmed in a dead zone)
  // on reconnect and on app foreground, even after the nav screen has unmounted.
  useEffect(() => {
    const stopNet = startAutoFlush()
    const stopApp = flushOnAppForeground()
    return () => { stopNet(); stopApp() }
  }, [])

  const hideShell =
    pathname.startsWith('/driver/maps') ||
    pathname.startsWith('/driver/messages')

  if (hideShell) {
    return <Slot />
  }

  return (
    <ReusableDashboardShell navItems={DRIVER_NAV}>
      <Slot />
    </ReusableDashboardShell>
  )
}