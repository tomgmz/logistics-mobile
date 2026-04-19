import { useLocalSearchParams } from 'expo-router'
import NavigationScreen from '../../../../components/ui/NavigationScreen'

export default function Page() {
  const { bookingId } = useLocalSearchParams<{ bookingId: string }>()
  return <NavigationScreen bookingId={bookingId} />
}