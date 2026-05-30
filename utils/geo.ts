import type {
  LatLng,
  Coord,
  TrafficSegment,
  TrafficSpeed,
  SpeedInterval,
} from '../types/navigation.types'

export function toCoord(p: LatLng): Coord {
  return [p.longitude, p.latitude]
}

export function toLineString(points: LatLng[]): GeoJSON.Feature<GeoJSON.LineString> {
  return {
    type:       'Feature',
    geometry:   { type: 'LineString', coordinates: points.map(toCoord) },
    properties: {},
  }
}

export function toTrafficFeatures(
  segments: TrafficSegment[],
): GeoJSON.FeatureCollection<GeoJSON.LineString> {
  return {
    type:     'FeatureCollection',
    features: segments.map((seg, i) => ({
      type:       'Feature',
      id:         String(i),
      geometry:   { type: 'LineString', coordinates: seg.coords.map(toCoord) },
      properties: { color: trafficColor(seg.speed) },
    })),
  }
}

export function trafficColor(speed: TrafficSpeed): string {
  switch (speed) {
    case 'fast':   return '#00e5ff'
    case 'normal': return '#00b8d9'
    case 'slow':   return '#f59e0b'
    case 'jam':    return '#ef4444'
  }
}

export function speedCategory(speed: string | number | undefined): TrafficSpeed {
  if (typeof speed === 'string') {
    switch (speed) {
      case 'NORMAL':      return 'normal'
      case 'SLOW':        return 'slow'
      case 'TRAFFIC_JAM': return 'jam'
      default:            return 'fast'
    }
  }
  if (speed === 1) return 'normal'
  if (speed === 2) return 'slow'
  if (speed === 3) return 'jam'
  return 'fast'
}

export function buildTrafficSegments(
  points: LatLng[],
  intervals: SpeedInterval[],
): TrafficSegment[] {
  if (!intervals?.length) return [{ coords: points, speed: 'fast' }]

  const segments: TrafficSegment[] = []
  for (const iv of intervals) {
    const start  = iv.startPolylinePointIndex ?? 0
    const end    = iv.endPolylinePointIndex   ?? points.length - 1
    const coords = points.slice(start, end + 2)
    if (coords.length >= 2) {
      segments.push({ coords, speed: speedCategory(iv.speed) })
    }
  }
  return segments.length > 0 ? segments : [{ coords: points, speed: 'fast' }]
}

export function decodePolyline(encoded: string): LatLng[] {
  const points: LatLng[] = []
  let index = 0, lat = 0, lng = 0
  while (index < encoded.length) {
    let shift = 0, result = 0, byte: number
    do { byte = encoded.charCodeAt(index++) - 63; result |= (byte & 0x1f) << shift; shift += 5 }
    while (byte >= 0x20)
    lat += result & 1 ? ~(result >> 1) : result >> 1
    shift = 0; result = 0
    do { byte = encoded.charCodeAt(index++) - 63; result |= (byte & 0x1f) << shift; shift += 5 }
    while (byte >= 0x20)
    lng += result & 1 ? ~(result >> 1) : result >> 1
    points.push({ latitude: lat / 1e5, longitude: lng / 1e5 })
  }
  return points
}

export function haversineDistance(a: LatLng, b: LatLng): number {
  const R     = 6_371_000
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat  = toRad(b.latitude  - a.latitude)
  const dLng  = toRad(b.longitude - a.longitude)
  const sl    = Math.sin(dLat / 2)
  const sg    = Math.sin(dLng / 2)
  return (
    2 * R * Math.asin(
      Math.sqrt(sl * sl + Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * sg * sg),
    )
  )
}

function pointToSegmentDistance(p: LatLng, a: LatLng, b: LatLng): number {
  const ax = a.longitude, ay = a.latitude
  const bx = b.longitude, by = b.latitude
  const px = p.longitude, py = p.latitude

  const dx = bx - ax
  const dy = by - ay
  const lenSq = dx * dx + dy * dy

  if (lenSq === 0) return haversineDistance(p, a)

  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq))

  const closest: LatLng = {
    latitude:  ay + t * dy,
    longitude: ax + t * dx,
  }
  return haversineDistance(p, closest)
}

export function distanceToPolyline(
  point: LatLng,
  polyline: LatLng[],
  lastSnapIdx = 0,
  windowSize  = 30,
): { distance: number; snapIdx: number } {
  if (polyline.length === 0) return { distance: Infinity, snapIdx: 0 }
  if (polyline.length === 1) return { distance: haversineDistance(point, polyline[0]), snapIdx: 0 }

  const start = Math.max(0, lastSnapIdx - 5)
  const end   = Math.min(polyline.length - 1, lastSnapIdx + windowSize)

  let minDist = Infinity
  let snapIdx = lastSnapIdx

  for (let i = start; i < end; i++) {
    const d = pointToSegmentDistance(point, polyline[i], polyline[i + 1])
    if (d < minDist) {
      minDist = d
      snapIdx = i
    }
  }

  if (minDist > 150) {
    for (let i = 0; i < polyline.length - 1; i++) {
      const d = pointToSegmentDistance(point, polyline[i], polyline[i + 1])
      if (d < minDist) {
        minDist = d
        snapIdx = i
      }
    }
  }

  return { distance: minDist, snapIdx }
}

export function fmtDuration(mins: number): string {
  if (mins < 60) return `${Math.round(mins)} min`
  const h = Math.floor(mins / 60)
  const m = Math.round(mins % 60)
  return m > 0 ? `${h}h ${m}m` : `${h}h`
}

export function fmtDistance(km: number): string {
  return km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km`
}

export function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim()
}

export function getBounds(points: LatLng[]): [[number, number], [number, number]] {
  const lngs = points.map((p) => p.longitude)
  const lats  = points.map((p) => p.latitude)
  return [
    [Math.max(...lngs), Math.max(...lats)],
    [Math.min(...lngs), Math.min(...lats)],
  ]
}