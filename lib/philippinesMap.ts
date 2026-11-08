import { useEffect, type RefObject } from 'react'
import type { MapViewController } from '@googlemaps/react-native-navigation-sdk'

/**
 * Every map in the app shows the Philippines only (same box as the web's
 * lib/philippines-map.ts): Tawi-Tawi to Batanes, Balabac to Davao Oriental.
 * Kalayaan is left out on purpose (no deliveries, and a lot of open sea).
 */
export const PH_BOUNDS = {
  north: 21.4,
  south: 4.4,
  west:  116.0,
  east:  127.0,
} as const

/**
 * The most a map may zoom out. At 5.5 a phone in portrait shows roughly the
 * whole country and little else.
 */
export const PH_MIN_ZOOM = 5.5

const CHECK_MS = 800

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

/**
 * The Navigation SDK's MapView has no camera bounds and no camera-moved event,
 * so this checks the camera every 800 ms and moves it back inside the
 * Philippines when it has been panned out. Bearing, tilt and zoom are kept.
 * A tiny native call; it does nothing while the camera is inside.
 */
export function useKeepCameraInPhilippines(
  controller: RefObject<MapViewController | null>,
  enabled = true,
) {
  useEffect(() => {
    if (!enabled) return
    let busy = false
    const id = setInterval(async () => {
      const map = controller.current
      if (!map || busy) return
      busy = true
      try {
        const cam = await map.getCameraPosition()
        const { lat, lng } = cam.target
        const cLat = clamp(lat, PH_BOUNDS.south, PH_BOUNDS.north)
        const cLng = clamp(lng, PH_BOUNDS.west, PH_BOUNDS.east)
        if (cLat !== lat || cLng !== lng) {
          map.moveCamera({ ...cam, target: { lat: cLat, lng: cLng } })
        }
      } catch {
        // Map not ready or gone; the next tick tries again.
      } finally {
        busy = false
      }
    }, CHECK_MS)
    return () => clearInterval(id)
  }, [controller, enabled])
}
