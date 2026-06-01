export interface LatLng {
  latitude:  number
  longitude: number
}

export type Coord = [number, number]


export type StopStatus = 'pending' | 'delivered' | 'failed'

export type TrafficSpeed = 'fast' | 'normal' | 'slow' | 'jam'

export interface Stop {
  destination_id:           string
  address:                  string
  latitude:                 number
  longitude:                number
  optimized_sequence_order: number
  status:                   StopStatus
  notes?:                   string | null
}

export interface RouteStep {
  instruction:   string
  distance:      string
  duration:      string
  maneuver?:     string
  startLocation: LatLng
}

export interface TrafficSegment {
  coords: LatLng[]
  speed:  TrafficSpeed
}

export interface BookingRoute {
  origin:          { latitude: number; longitude: number; address: string }
  stops:           Stop[]
  total_duration:  number
  total_distance:  number
  polyline:        LatLng[]
  trafficSegments: TrafficSegment[]
  steps:           RouteStep[]
  // Persisted in the offline cache so an offline restart mid-trip remembers
  // that pickup already happened and doesn't re-fire the arrival.
  arrivedPickup?:  boolean
}

export interface SpeedInterval {
  startPolylinePointIndex?: number
  endPolylinePointIndex?:   number
  speed?:                   string | number
}