import { useCallback, useEffect, useRef, useState } from 'react'
import * as Location from 'expo-location'
import MapboxGL from '@rnmapbox/maps'

import type { LatLng } from '../types/navigation.types'
import { toCoord } from '../utils/geo'

interface UseGPSOptions {
  cameraRef: React.RefObject<MapboxGL.Camera | null>
  trackingModeRef:    React.RefObject<boolean>
  onLocationUpdateRef?: React.RefObject<((pos: LatLng) => void) | undefined>
  onError?: (msg: string) => void
}

interface UseGPSReturn {
  userLocation: LatLng | null
  userLocationRef: React.MutableRefObject<LatLng | null>
  heading: number
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

  const setPos = useCallback((pos: LatLng, hdg: number) => {
    setUserLocation(pos)
    userLocationRef.current = pos
    setHeading(hdg)
  }, [])

  useEffect(() => {
    let sub: Location.LocationSubscription | null = null

    ;(async () => {
      const { status } = await Location.requestForegroundPermissionsAsync()
      if (status !== 'granted') {
        onError?.('Location permission denied. Please enable it in Settings.')
        return
      }

      const last = await Location.getLastKnownPositionAsync()
      if (last) {
        setPos(
          { latitude: last.coords.latitude, longitude: last.coords.longitude },
          last.coords.heading ?? 0,
        )
      }

      const loc = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      })
      setPos(
        { latitude: loc.coords.latitude, longitude: loc.coords.longitude },
        loc.coords.heading ?? 0,
      )

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
          const hdg = update.coords.heading ?? 0
          setPos(pos, hdg)

          if (trackingModeRef.current) {
            cameraRef.current?.setCamera({
              centerCoordinate: toCoord(pos),
              heading:          hdg,
              pitch:            45,
              zoomLevel:        17,
              animationDuration: 500,
            })
          }

          onLocationUpdateRef?.current?.(pos)
        },
      )
    })()

    return () => { sub?.remove() }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return { userLocation, userLocationRef, heading }
}