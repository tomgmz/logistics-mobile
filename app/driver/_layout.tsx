import ReusableDashboardShell, { DEFAULT_NAV_ITEMS } from '../../components/ui/ReusableDashboardShell'
import { Slot } from 'expo-router'
import { MapPin, ClipboardList } from 'lucide-react-native'

const DRIVER_NAV = [
  {
    href:  '/driver/driver-assignment',
    label: 'Assignments',
    icon:  <ClipboardList size={17} color="rgba(255,255,255,0.40)" />,
  },
  {
    href:  '/driver/maps',
    label: 'Map',
    icon:  <MapPin size={17} color="rgba(255,255,255,0.40)" />,
  },
    {
    href:  '/driver/maintenance',
    label: 'Maintenance',
    icon:  <MapPin size={17} color="rgba(255,255,255,0.40)" />,
  },
]

export default function DriverLayout() {
  return (
    <ReusableDashboardShell navItems={DRIVER_NAV}>
      <Slot />
    </ReusableDashboardShell>
  )
}