import { useLocalSearchParams } from 'expo-router'
import NavigationScreen from '../../../../components/maps/NavigationScreen'

export default function MapsPage() {
  const { bookingId } = useLocalSearchParams<{ bookingId: string }>()
  return <NavigationScreen bookingId={bookingId} />
}