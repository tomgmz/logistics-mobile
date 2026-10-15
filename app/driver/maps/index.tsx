import { useRouter } from 'expo-router'
import BrowseMapScreen from '../../../components/maps/shared/BrowseMapScreen'

/** The home screen's Maps shortcut: a plain map to look around on, not a booking. */
export default function BrowseMapPage() {
  const router = useRouter()
  return <BrowseMapScreen onBack={() => router.back()} />
}
