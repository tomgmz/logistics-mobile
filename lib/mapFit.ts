/**
 * The zoom that fits a bounding box into a viewport — the Web Mercator maths
 * Google's own `fitBounds` uses.
 *
 * The SDK's MapViewController has no bounds-fitting call (only `moveCamera` and
 * `setZoomLevel`), so the fit has to be computed here. Doing it from the span
 * alone gets it wrong: a route that is wide but short needs a different zoom
 * than a tall narrow one, and that depends on the viewport's own proportions.
 */
const WORLD_PX = 256
const MAX_ZOOM = 18

function latRad(lat: number): number {
  const sin   = Math.sin((lat * Math.PI) / 180)
  const radX2 = Math.log((1 + sin) / (1 - sin)) / 2
  return Math.max(Math.min(radX2, Math.PI), -Math.PI) / 2
}

export function fitZoom(
  bounds: { north: number; south: number; east: number; west: number },
  viewport: { width: number; height: number },
): number {
  const latFraction = (latRad(bounds.north) - latRad(bounds.south)) / Math.PI
  const lngDiff     = bounds.east - bounds.west
  const lngFraction = (lngDiff < 0 ? lngDiff + 360 : lngDiff) / 360

  // A degenerate span (one stop, or stops on top of each other) would divide by
  // ~0 and shoot to max zoom; clamp both fractions to something a street-level
  // view can represent.
  const latZoom = Math.log2(viewport.height / WORLD_PX / Math.max(latFraction, 1e-6))
  const lngZoom = Math.log2(viewport.width  / WORLD_PX / Math.max(lngFraction, 1e-6))

  return Math.min(latZoom, lngZoom, MAX_ZOOM)
}
