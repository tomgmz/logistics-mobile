import { useState } from 'react'
import { useLocalSearchParams, useRouter } from 'expo-router'
import GoogleNavigationScreen from '../../../../components/maps/google/GoogleNavigationScreen'
import MapboxNavSDKScreen from '../../../../components/maps/mapbox/MapboxNavSDKScreen'
import BookingDetailsScreen from '../../../../components/maps/shared/BookingDetailsScreen'
import { getNavProvider } from '../../../../lib/config/featureFlags'

export default function MapsPage() {
  const { bookingId } = useLocalSearchParams<{ bookingId: string }>()
  const router        = useRouter()

  // Driver flow: booking details → live navigation. The provider (Google
  // Navigation SDK vs the Mapbox Navigation SDK drop-in) is chosen by
  // EXPO_PUBLIC_NAV_PROVIDER; both are linked into the native build, so this is
  // a runtime switch.
  const [started, setStarted] = useState(false)

  if (!started) {
    return (
      <BookingDetailsScreen
        bookingId={bookingId}
        onStart={() => setStarted(true)}
        onBack={() => router.back()}
      />
    )
  }

  return getNavProvider() === 'mapbox'
    ? <MapboxNavSDKScreen bookingId={bookingId} />
    : <GoogleNavigationScreen bookingId={bookingId} />
}
