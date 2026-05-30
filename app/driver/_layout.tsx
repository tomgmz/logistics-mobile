import ReusableDashboardShell from '../../components/ui/ReusableDashboardShell'
import { Slot } from 'expo-router'
import { Toolbox, ClipboardList } from 'lucide-react-native'
import { usePathname } from 'expo-router'

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

  // Hide the shell for map screens and individual chat screens (not the list)
  const hideShell =
    pathname.startsWith('/driver/maps') ||
    (pathname.startsWith('/driver/messages/') && pathname !== '/driver/messages')

  if (hideShell) {
    return <Slot />
  }

  return (
    <ReusableDashboardShell navItems={DRIVER_NAV}>
      <Slot />
    </ReusableDashboardShell>
  )
}