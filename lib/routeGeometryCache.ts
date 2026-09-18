import AsyncStorage from '@react-native-async-storage/async-storage'

import type { DisplayStop } from './navSession'

/**
 * The last route the Google Navigation SDK actually built for a booking, kept on
 * disk so a COLD OPEN in a dead zone still has something to show.
 *
 * The SDK holds its own route in memory and keeps guiding on it through a
 * tunnel, so a driver who merely leaves the screen and comes back is already
 * covered (lib/navSession re-attaches to the live native session). What isn't
 * covered is the app dying — a crash, a reboot, Android reclaiming it in the
 * yard — because the native session goes with it, and rebuilding the route
 * needs network the driver doesn't have. Before this cache, that driver got an
 * error screen and nothing else: no map, no line, no idea which bay was next.
 *
 * What this restores is a PICTURE, not guidance: the route line, the stop
 * markers and the stop list, on a map that will be mostly blank until tiles come
 * back. There is no turn-by-turn, no rerouting and no snapping — only Google can
 * produce those, and only online. Treat it as "here is the shape of your run and
 * where you were up to", which is enough to keep driving on local knowledge
 * until signal returns.
 *
 * Geometry is stored ONCE PER BOOKING and overwritten as the run progresses, so
 * a restore always draws the route from the leg the driver was actually on.
 */

const routeGeometryKey = (bookingId: string) => `nav_route_geometry_${bookingId}`

/**
 * How old a cached route may be and still be worth drawing.
 *
 * A route that has been sitting for a day belongs to a run that is over, or to
 * road conditions that have moved on; drawing it would be worse than drawing
 * nothing, because the driver would trust it. A single shift is the useful
 * window — anything longer and the restore should fall back to markers alone.
 */
export const ROUTE_GEOMETRY_MAX_AGE_MS = 18 * 60 * 60 * 1000

/**
 * Ceiling on stored points. Google returns the full polyline — thousands of
 * vertices on a provincial run — and AsyncStorage is a single JSON blob on the
 * UI thread's doorstep. At preview zoom the line is indistinguishable well below
 * this, so the excess buys nothing and costs a stutter on every save.
 */
const MAX_POINTS = 1_200

export interface GeoPoint {
  latitude:  number
  longitude: number
}

/** A stop as the preview draws it: where it is, and what to call it. */
export interface RouteStopMarker extends GeoPoint {
  /**
   * Which entry of `stops` this marker belongs to.
   *
   * Carried explicitly because the two lists are NOT parallel: a stop the office
   * never geocoded has no coordinates and so no marker, and every marker after it
   * would otherwise be attributed to the wrong bay — the one thing a driver must
   * never be shown.
   */
  stopIndex: number
  kind:      'pickup' | 'dropoff'
  /** Drop-off number within the run; absent on the pickup. */
  number?:   number
  label:     string
}

export interface CachedRouteGeometry {
  bookingId: string
  /** Epoch ms of the save — checked against ROUTE_GEOMETRY_MAX_AGE_MS. */
  savedAt:   number
  /** The route line from the leg the driver was on, decimated. May be empty. */
  points:    GeoPoint[]
  /** Every stop of the run, including ones already confirmed. */
  markers:   RouteStopMarker[]
  /** Which stop the driver was heading to when this was saved. */
  legIndex:  number
  /** The sheet's stop list, so a restore doesn't depend on the booking cache. */
  stops:     DisplayStop[]
}

/**
 * Thin `points` down to at most MAX_POINTS by taking an even stride.
 *
 * Evenly, not cleverly: a shape-preserving simplification (Douglas–Peucker)
 * would keep corners better, but this runs on every reroute on a mid-range
 * Android phone that is also drawing a map, and a stride is O(n) with no
 * allocation per vertex. The first and last points are always kept so the line
 * still starts and ends where the route does.
 */
export function decimate(points: GeoPoint[], max = MAX_POINTS): GeoPoint[] {
  if (points.length <= max) return points

  const stride = Math.ceil(points.length / max)
  const out: GeoPoint[] = []
  for (let i = 0; i < points.length; i += stride) out.push(points[i])

  const last = points[points.length - 1]
  if (out[out.length - 1] !== last) out.push(last)
  return out
}

/** Drop anything that isn't a real coordinate — the SDK occasionally emits nulls. */
export function sanitise(points: (GeoPoint | null | undefined)[]): GeoPoint[] {
  return points.filter(
    (p): p is GeoPoint =>
      !!p &&
      typeof p.latitude === 'number' &&
      typeof p.longitude === 'number' &&
      Number.isFinite(p.latitude) &&
      Number.isFinite(p.longitude),
  )
}

export async function saveRouteGeometry(
  geometry: Omit<CachedRouteGeometry, 'savedAt'>,
): Promise<void> {
  try {
    const payload: CachedRouteGeometry = {
      ...geometry,
      points:  decimate(sanitise(geometry.points)),
      savedAt: Date.now(),
    }
    await AsyncStorage.setItem(routeGeometryKey(geometry.bookingId), JSON.stringify(payload))
  } catch { /* non-critical: the preview simply won't have a line */ }
}

/**
 * The cached route, or null when there is none, it can't be read, or it is past
 * ROUTE_GEOMETRY_MAX_AGE_MS. A stale entry is deleted on the way out rather than
 * left to be re-read and re-rejected on every cold open.
 */
export async function loadRouteGeometry(bookingId: string): Promise<CachedRouteGeometry | null> {
  try {
    const raw = await AsyncStorage.getItem(routeGeometryKey(bookingId))
    if (!raw) return null

    const parsed = JSON.parse(raw) as CachedRouteGeometry
    if (!parsed || parsed.bookingId !== bookingId) return null

    if (Date.now() - (parsed.savedAt ?? 0) > ROUTE_GEOMETRY_MAX_AGE_MS) {
      clearRouteGeometry(bookingId)
      return null
    }

    return {
      ...parsed,
      points:  sanitise(parsed.points ?? []),
      markers: (parsed.markers ?? []).filter((m) => sanitise([m]).length === 1),
      stops:   parsed.stops ?? [],
    }
  } catch {
    return null
  }
}

export async function clearRouteGeometry(bookingId: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(routeGeometryKey(bookingId))
  } catch { /* non-critical */ }
}
