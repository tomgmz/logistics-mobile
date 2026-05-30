import { useCallback, useEffect, useRef, useState } from 'react'
import * as Location from 'expo-location'
import MapboxGL      from '@rnmapbox/maps'

import type { LatLng } from '../types/navigation.types'
import { toCoord }     from '../utils/geo'

const HEADING_SMOOTH = 0.3

interface UseGPSOptions {
  cameraRef:            React.RefObject<MapboxGL.Camera | null>
  trackingModeRef:      React.RefObject<boolean>
  onLocationUpdateRef?: React.RefObject<((pos: LatLng) => void) | undefined>
  onError?:             (msg: string) => void
}

interface UseGPSReturn {
  userLocation:    LatLng | null
  userLocationRef: React.MutableRefObject<LatLng | null>
  heading:         number
  headingRef:      React.MutableRefObject<number> 
}

export function useGPS({
  cameraRef,
  trackingModeRef,
  onLocationUpdateRef,
  onError,
}: UseGPSOptions): UseGPSReturn {
  const [userLocation, setUserLocation] = useState<LatLng | null>(null)
  const [heading,      setHeading]      = useState(0)

  const userLocationRef = useRef<LatLng | null>(null)
  const smoothHeading   = useRef(0)

  const applyHeading = useCallback((raw: number) => {
    const delta       = ((raw - smoothHeading.current + 540) % 360) - 180
    smoothHeading.current = (smoothHeading.current + delta * HEADING_SMOOTH + 360) % 360
    setHeading(smoothHeading.current)
    return smoothHeading.current
  }, [])

  const setPos = useCallback((pos: LatLng, rawHdg: number) => {
    setUserLocation(pos)
    userLocationRef.current = pos
    applyHeading(rawHdg)
  }, [applyHeading])

  useEffect(() => {
    let sub:       Location.LocationSubscription | null = null
    let cancelled = false

    ;(async () => {
      const { status } = await Location.requestForegroundPermissionsAsync()
      if (status !== 'granted') {
        onError?.('Location permission denied. Please enable it in Settings.')
        return
      }

      try {
        const last = await Location.getLastKnownPositionAsync()
        if (last && !cancelled) {
          setPos(
            { latitude: last.coords.latitude, longitude: last.coords.longitude },
            last.coords.heading ?? 0,
          )
        }
      } catch { /* no last-known position */ }

      let gotFix  = false
      let attempt = 0
      while (!cancelled && !gotFix) {
        try {
          const loc = await Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.Balanced,
          })
          if (!cancelled) {
            setPos(
              { latitude: loc.coords.latitude, longitude: loc.coords.longitude },
              loc.coords.heading ?? 0,
            )
          }
          gotFix = true
        } catch {
          const delay = Math.min(1_000 * Math.pow(2, attempt), 10_000)
          attempt++
          await new Promise((r) => setTimeout(r, delay))
        }
      }

      if (!gotFix && !cancelled) {
        onError?.('Could not get your location. Make sure GPS is on and try again.')
      }

      if (cancelled) return

      sub = await Location.watchPositionAsync(
        {
          accuracy:         Location.Accuracy.BestForNavigation,
          timeInterval:     2_000,
          distanceInterval: 5,
        },
        (update) => {
          const pos = {
            latitude:  update.coords.latitude,
            longitude: update.coords.longitude,
          }
          const smooth = applyHeading(update.coords.heading ?? 0)
          setUserLocation(pos)
          userLocationRef.current = pos

          if (trackingModeRef.current) {
            cameraRef.current?.setCamera({
              centerCoordinate:  toCoord(pos),
              heading:           smooth,
              pitch:             45,
              zoomLevel:         17,
              animationDuration: 500,
            })
          }

          onLocationUpdateRef?.current?.(pos)
        },
      )
    })()

    return () => {
      cancelled = true
      sub?.remove()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return { userLocation, userLocationRef, heading, headingRef: smoothHeading }
}