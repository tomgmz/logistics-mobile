import { useState } from 'react'
import { useLocalSearchParams, useRouter } from 'expo-router'
import GoogleNavigationScreen from '../../../../components/maps/google/GoogleNavigationScreen'
import MapboxNavSDKScreen from '../../../../components/maps/mapbox/MapboxNavSDKScreen'
import BookingDetailsScreen from '../../../../components/maps/shared/BookingDetailsScreen'
import RoutePreviewScreen from '../../../../components/maps/shared/RoutePreviewScreen'
import { getNavProvider } from '../../../../lib/config/featureFlags'

type Stage = 'details' | 'preview' | 'navigating'

export default function MapsPage() {
  const { bookingId } = useLocalSearchParams<{ bookingId: string }>()
  const router        = useRouter()

  // Driver flow: booking details → live navigation, with a read-only route
  // preview hanging off the details screen for jobs that aren't due yet. The
  // provider (Google Navigation SDK vs the Mapbox Navigation SDK drop-in) is
  // chosen by EXPO_PUBLIC_NAV_PROVIDER; both are linked into the native build,
  // so this is a runtime switch.
  const [stage, setStage] = useState<Stage>('details')

  // Set when the driver deliberately starts a booking ahead of its scheduled
  // day. It has to survive the hand-off into navigation, because the pickup
  // confirmation happens in there and the server refuses an early pickup that
  // doesn't declare itself.
  const [earlyStart, setEarlyStart] = useState(false)

  if (stage === 'preview') {
    return (
      <RoutePreviewScreen
        bookingId={bookingId}
        onBack={() => setStage('details')}
      />
    )
  }

  if (stage === 'details') {
    return (
      <BookingDetailsScreen
        bookingId={bookingId}
        onStart={(early) => { setEarlyStart(early); setStage('navigating') }}
        onPreview={() => setStage('preview')}
        onBack={() => router.back()}
      />
    )
  }

  return getNavProvider() === 'mapbox'
    ? <MapboxNavSDKScreen bookingId={bookingId} earlyStart={earlyStart} />
    : <GoogleNavigationScreen bookingId={bookingId} earlyStart={earlyStart} />
}
