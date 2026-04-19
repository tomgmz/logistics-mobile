import { View } from 'react-native'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import DriverBookingList from '../../driver/driver-assignment'
import { useAuthStore } from '../../../lib/store/auth.store'

export default function MapsIndexPage() {
  const { user, accessToken } = useAuthStore()

  if (!user?.drivers?.driver_id || !accessToken) return null

  return (
    <SafeAreaProvider>
      <View className="flex-1 bg-[#F7F6F2]">
        <DriverBookingList/>
      </View>
    </SafeAreaProvider>
  )
}