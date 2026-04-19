import api from '../auth.api'

export interface LatLng {
  latitude:  number
  longitude: number
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
  speed:  'fast' | 'normal' | 'slow' | 'jam'
}

export interface Route {
  polyline:        LatLng[]
  steps:           RouteStep[]
  distanceMeters:  number
  durationSeconds: number
  trafficSegments: TrafficSegment[]
}

export function decodePolyline(encoded: string): LatLng[] {
  const points: LatLng[] = []
  let index = 0, lat = 0, lng = 0

  while (index < encoded.length) {
    let shift = 0, result = 0, byte: number
    do {
      byte    = encoded.charCodeAt(index++) - 63
      result |= (byte & 0x1f) << shift
      shift  += 5
    } while (byte >= 0x20)
    lat += result & 1 ? ~(result >> 1) : result >> 1

    shift = 0; result = 0
    do {
      byte    = encoded.charCodeAt(index++) - 63
      result |= (byte & 0x1f) << shift
      shift  += 5
    } while (byte >= 0x20)
    lng += result & 1 ? ~(result >> 1) : result >> 1

    points.push({ latitude: lat / 1e5, longitude: lng / 1e5 })
  }

  return points
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim()
}

function speedCategory(speed: any): TrafficSegment['speed'] {
  const s = String(speed).toUpperCase();
  
  if (s === 'JAM' || s === '3') return 'jam';
  if (s === 'SLOW' || s === '2') return 'slow';
  if (s === 'NORMAL' || s === '1') return 'normal';
  
  return 'fast';
}

export function buildTrafficSegments(
  points: LatLng[],
  intervals: any[]
): TrafficSegment[] {
  if (!intervals || intervals.length === 0) {
    return [{ coords: points, speed: 'fast' }];
  }

  const segments: TrafficSegment[] = [];
  
  const sortedIntervals = [...intervals].sort((a, b) => 
    (a.startPolylinePointIndex ?? 0) - (b.startPolylinePointIndex ?? 0)
  );

  sortedIntervals.forEach((iv) => {
    const start = iv.startPolylinePointIndex ?? 0;
    const end = iv.endPolylinePointIndex ?? points.length - 1;
    
    const coords = points.slice(start, Math.min(end + 1, points.length));

    if (coords.length >= 2) {
      segments.push({
        coords,
        speed: speedCategory(iv.speed)
      });
    }
  });

  return segments;
}

function normalizeSteps(legs: any[]): RouteStep[] {
  return (legs ?? []).flatMap((leg: any) =>
    (leg.steps ?? []).map((step: any): RouteStep => ({
      instruction:   stripHtml(
        step.navigationInstruction?.instructions ??
        step.localizedValues?.distance?.text     ??
        '',
      ),
      distance:      step.localizedValues?.distance?.text       ?? '',
      duration:      step.localizedValues?.duration?.text ?? step.localizedValues?.staticDuration?.text ?? '',
      maneuver:      step.navigationInstruction?.maneuver?.toLowerCase() ?? '',
      startLocation: {
        latitude:  step.startLocation?.latLng?.latitude  ?? 0,
        longitude: step.startLocation?.latLng?.longitude ?? 0,
      },
    })),
  )
}


interface ComputeRouteParams {
  origin:       LatLng
  destination:  LatLng
  intermediates?: LatLng[]
  routingPreference?: string
}

export async function computeRoute(params: ComputeRouteParams): Promise<Route> {
  const { origin, destination, intermediates = [], routingPreference = 'TRAFFIC_AWARE' } = params

  const res = await api.post('/directions', {
    origin:      { location: { latLng: { latitude: origin.latitude, longitude: origin.longitude } } },
    destination: { location: { latLng: { latitude: destination.latitude, longitude: destination.longitude } } },
    ...(intermediates.length > 0 && {
      intermediates: intermediates.map((p) => ({ location: { latLng: p } })),
    }),
    travelMode:        'DRIVE',
    routingPreference,
    routeModifiers:    { avoidFerries: true },
    units:             'METRIC',
    extraComputations: ['TRAFFIC_ON_POLYLINE'],
  })

  const raw      = res.data.data.routes[0]
  const polyline = decodePolyline(raw.polyline.encodedPolyline)

  return {
    polyline,
    steps:           normalizeSteps(raw.legs ?? []),
    distanceMeters:  raw.distanceMeters ?? 0,
    durationSeconds: parseInt(raw.duration ?? '0', 10),
    trafficSegments: buildTrafficSegments(
      polyline,
      raw.travelAdvisory?.speedReadingIntervals ?? [],
    ),
  }
}