export interface LatLng {
  latitude:  number
  longitude: number
}

export type StopStatus = 'pending' | 'delivered' | 'failed'

export interface Stop {
  destination_id:           string
  address:                  string
  latitude:                 number
  longitude:                number
  optimized_sequence_order: number
  status:                   StopStatus
  notes?:                   string | null
}

export interface BookingRoute {
  origin:          { latitude: number; longitude: number; address: string }
  stops:           Stop[]
  total_duration:  number
  total_distance:  number
}