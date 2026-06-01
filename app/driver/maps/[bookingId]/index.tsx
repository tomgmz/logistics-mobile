import { useLocalSearchParams } from 'expo-router'
import NavigationScreen from '../../../../components/maps/NavigationScreen'
import GoogleNavigationScreen from '../../../../components/maps/GoogleNavigationScreen'
import { getNavProvider } from '../../../../lib/config/featureFlags'

export default function MapsPage() {
  const { bookingId } = useLocalSearchParams<{ bookingId: string }>()

  // Defaults to the custom Mapbox stack. Set EXPO_PUBLIC_NAV_PROVIDER=google
  // to trial the Google Navigation SDK. See docs/google-nav-sdk-migration.md.
  if (getNavProvider() === 'google') {
    return <GoogleNavigationScreen bookingId={bookingId} />
  }
  return <NavigationScreen bookingId={bookingId} />
}