import React, { ReactNode, useState } from 'react'
import { View, StyleSheet } from 'react-native'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { Home, Package, Truck, BarChart2, Users } from 'lucide-react-native'

import ReusableHeader from './ReusableHeader'
import ReusableSidebar, { NavItem } from './ReusableSideBar'
import { useAuthStore } from '../../lib/store/auth.store'
import { useAvailabilityStore } from '../../lib/store/availability.store'
import { logout } from '../../lib/api/auth.api'
import { unregisterPushNotifications } from '../../lib/push'

const ICON_COLOR = 'rgba(255,255,255,0.40)'
const ICON_SIZE  = 17

export const DEFAULT_NAV_ITEMS: NavItem[] = [
  { href: '/dashboard',          label: 'Dashboard', icon: <Home      size={ICON_SIZE} color={ICON_COLOR} /> },
  { href: '/dashboard/bookings', label: 'Bookings',  icon: <Package   size={ICON_SIZE} color={ICON_COLOR} /> },
  { href: '/dashboard/fleet',    label: 'Fleet',     icon: <Truck     size={ICON_SIZE} color={ICON_COLOR} /> },
  { href: '/dashboard/reports',  label: 'Reports',   icon: <BarChart2 size={ICON_SIZE} color={ICON_COLOR} /> },
  { href: '/dashboard/clients',  label: 'Clients',   icon: <Users     size={ICON_SIZE} color={ICON_COLOR} /> },
]

interface ReusableDashboardShellProps {
  children:  ReactNode
  navItems?: NavItem[]
}

export default function ReusableDashboardShell({
  children,
  navItems = DEFAULT_NAV_ITEMS,
}: ReusableDashboardShellProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const router    = useRouter()
  const clearUser = useAuthStore((s) => s.clearUser)

  const handleLogout = async () => {
    try {
      await unregisterPushNotifications()
      await logout()
    } catch {
    } finally {
      clearUser()
      // Availability is per driver — drop it so the next sign-in on this device
      // doesn't show the previous driver's switch state.
      useAvailabilityStore.getState().reset()
      router.replace('/')
    }
  }

  return (
    <SafeAreaProvider>
      <View style={styles.root}>
        <ReusableHeader
          sidebarOpen={sidebarOpen}
          onToggleSidebar={() => setSidebarOpen(!sidebarOpen)}
        />

        <View style={styles.body}>
          <ReusableSidebar
            navItems={navItems}
            sidebarOpen={sidebarOpen}
            setSidebarOpen={setSidebarOpen}
            onLogout={handleLogout}
          />

          <View style={styles.main}>
            {children}
          </View>
        </View>
      </View>
    </SafeAreaProvider>
  )
}

const styles = StyleSheet.create({
  root: {
    flex:            1,
    backgroundColor: '#1a1a1a',
  },
  body: {
    flex:     1,
    position: 'relative',
  },
  main: {
    flex:            1,
    backgroundColor: '#1e1e1e',
  },
})