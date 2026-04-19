import type { LatLng, RouteStep } from './routingService'

export const REROUTE_THRESHOLD_M      = 80
export const STEP_ADVANCE_THRESHOLD_M = 40
export const REROUTE_COOLDOWN_S       = 20

const EARTH_RADIUS_M = 6_371_000
const toRad = (d: number) => (d * Math.PI) / 180

export function haversineDistance(a: LatLng, b: LatLng): number {
  const dLat   = toRad(b.latitude  - a.latitude)
  const dLng   = toRad(b.longitude - a.longitude)
  const sinLat = Math.sin(dLat / 2)
  const sinLng = Math.sin(dLng / 2)
  return (
    2 * EARTH_RADIUS_M *
    Math.asin(
      Math.sqrt(
        sinLat * sinLat +
          Math.cos(toRad(a.latitude)) *
            Math.cos(toRad(b.latitude)) *
            sinLng * sinLng,
      ),
    )
  )
}

function nearestPointOnSegment(p: LatLng, a: LatLng, b: LatLng): LatLng {
  const cosLat = Math.cos(toRad((a.latitude + b.latitude) / 2))

  const ax = a.longitude * cosLat
  const ay = a.latitude
  const bx = b.longitude * cosLat
  const by = b.latitude
  const px = p.longitude * cosLat
  const py = p.latitude

  const dx = bx - ax
  const dy = by - ay
  const lenSq = dx * dx + dy * dy

  if (lenSq === 0) return a

  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq))

  return {
    latitude:  ay + t * dy,
    longitude: (ax + t * dx) / cosLat,
  }
}

export function distanceFromPolyline(pos: LatLng, polyline: LatLng[]): number {
  if (polyline.length === 0) return Infinity
  if (polyline.length === 1) return haversineDistance(pos, polyline[0]!)

  let best = Infinity
  for (let i = 0; i < polyline.length - 1; i++) {
    const nearest = nearestPointOnSegment(pos, polyline[i]!, polyline[i + 1]!)
    const d = haversineDistance(pos, nearest)
    if (d < best) best = d
  }
  return best
}

export function getNextStepIndex(
  currentStep: number,
  steps:        RouteStep[],
  pos:          LatLng,
): number | null {
  const nextIndex = currentStep + 1
  if (nextIndex >= steps.length) return null

  const next = steps[nextIndex]
  if (!next?.startLocation) return null

  return haversineDistance(pos, next.startLocation) <= STEP_ADVANCE_THRESHOLD_M
    ? nextIndex
    : null
}

export interface OffRouteDetector {
  check(pos: LatLng, polyline: LatLng[]): boolean
  resetCooldown(): void
}

export function createOffRouteDetector(): OffRouteDetector {
  let lastRerouteAt = 0

  return {
    check(pos: LatLng, polyline: LatLng[]): boolean {
      const nowSec = Date.now() / 1000
      if (nowSec - lastRerouteAt < REROUTE_COOLDOWN_S) return false

      const dist = distanceFromPolyline(pos, polyline)
      if (dist > REROUTE_THRESHOLD_M) {
        lastRerouteAt = nowSec
        return true
      }
      return false
    },

    resetCooldown() {
      lastRerouteAt = 0
    },
  }
}