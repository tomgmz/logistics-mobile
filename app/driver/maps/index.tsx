import { useLocalSearchParams, useRouter } from 'expo-router'
import BrowseMapScreen from '../../../components/maps/shared/BrowseMapScreen'

/**
 * The home screen's Maps shortcut: a plain map to look around on, not a booking.
 * With ?lat=&lng=&label= it opens on that point instead — what the app's
 * "open in Google Maps" buttons use, so nothing leaves the app.
 */
export default function BrowseMapPage() {
  const router = useRouter()
  const { lat, lng, label } = useLocalSearchParams<{ lat?: string; lng?: string; label?: string }>()
  const latitude  = Number(lat)
  const longitude = Number(lng)
  const pin = lat && lng && Number.isFinite(latitude) && Number.isFinite(longitude)
    ? { latitude, longitude, label: label || 'Pinned location' }
    : undefined
  return <BrowseMapScreen onBack={() => router.back()} pin={pin} />
}
