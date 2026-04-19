import { useLocalSearchParams } from 'expo-router'
import NavigationScreen from '../../../components/ui/NavigationScreen'

export default function Page() {
  const { bookingId } = useLocalSearchParams<{ bookingId: string }>()
  return <NavigationScreen bookingId={"ad0e80da-8d76-431a-bd23-f5ae018a4078"} />
}