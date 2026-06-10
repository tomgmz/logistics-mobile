import React from 'react'
import { Text, View } from 'react-native'
import MapboxGL       from '@rnmapbox/maps'
import { Navigation2, Truck } from 'lucide-react-native'

import { C }                          from '../../../theme/navigation.theme'
import { toCoord, toTrafficFeatures } from '../../../utils/geo'
import type { BookingRoute, LatLng, Stop, TrafficSegment } from '../../../types/navigation.types'

interface TrafficLayerProps {
  segments: TrafficSegment[]
  routeVersion: number
}

export function TrafficLayer({ segments, routeVersion }: TrafficLayerProps) {
  const geoJSON = React.useMemo(() => toTrafficFeatures(segments), [segments])
  const sourceKey = React.useMemo(() => {
    if (!segments.length) return 'traffic:none'
    const firstSeg = segments[0]!
    const lastSeg = segments[segments.length - 1]!
    const totalCoords = segments.reduce((acc, s) => acc + (s.coords?.length ?? 0), 0)
    const firstStart = firstSeg.coords[0]
    const firstEnd   = firstSeg.coords[firstSeg.coords.length - 1]
    const lastStart  = lastSeg.coords[0]
    const lastEnd    = lastSeg.coords[lastSeg.coords.length - 1]
    return [
      `n:${segments.length}`,
      `t:${totalCoords}`,
      `a:${firstStart ? firstStart.latitude.toFixed(5) : 'x'}`,
      `b:${firstStart ? firstStart.longitude.toFixed(5) : 'x'}`,
      `c:${firstEnd ? firstEnd.latitude.toFixed(5) : 'x'}`,
      `d:${firstEnd ? firstEnd.longitude.toFixed(5) : 'x'}`,
      `e:${lastStart ? lastStart.latitude.toFixed(5) : 'x'}`,
      `f:${lastStart ? lastStart.longitude.toFixed(5) : 'x'}`,
      `g:${lastEnd ? lastEnd.latitude.toFixed(5) : 'x'}`,
      `h:${lastEnd ? lastEnd.longitude.toFixed(5) : 'x'}`,
    ].join('|')
  }, [segments])
  return (
    <MapboxGL.ShapeSource key={`traffic:${routeVersion}:${sourceKey}`} id="traffic-source" shape={geoJSON}>
      <MapboxGL.LineLayer
        id="traffic-line"
        style={{
          lineColor: ['get', 'color'] as any,
          lineWidth: 6,
          lineCap:   'round',
          lineJoin:  'round',
        }}
      />
      <MapboxGL.LineLayer
        id="traffic-line-outline"
        belowLayerID="traffic-line"
        style={{
          lineColor: 'rgba(0,0,0,0.35)',
          lineWidth: 9,
          lineCap:   'round',
          lineJoin:  'round',
        }}
      />
    </MapboxGL.ShapeSource>
  )
}

interface OriginMarkerProps {
  origin: BookingRoute['origin']
}

export function OriginMarker({ origin }: OriginMarkerProps) {
  return (
    <MapboxGL.MarkerView id="origin" coordinate={toCoord(origin)}>
      <View
        style={{
          width: 38, height: 38, borderRadius: 19,
          backgroundColor: C.cyanDim,
          borderWidth: 2, borderColor: C.cyan,
          alignItems: 'center', justifyContent: 'center',
          shadowColor: C.cyan, shadowOffset: { width: 0, height: 0 },
          shadowOpacity: 0.7, shadowRadius: 10, elevation: 8,
        }}
      >
        <Truck size={14} color={C.cyan} />
      </View>
    </MapboxGL.MarkerView>
  )
}

interface StopMarkersProps {
  stops:       Stop[]
  nextStopId?: string
}

export function StopMarkers({ stops, nextStopId }: StopMarkersProps) {
  return (
    <>
      {stops.map((stop) => {
        const delivered = stop.status === 'delivered'
        const failed    = stop.status === 'failed'
        const isNext    = stop.destination_id === nextStopId
        const bg        =
          delivered ? C.green :
          failed    ? C.red   :
          isNext    ? C.orange : C.surfaceHi
        const border = isNext ? C.orange : bg

        return (
          <MapboxGL.MarkerView
            key={stop.destination_id}
            id={stop.destination_id}
            coordinate={toCoord(stop)}
            anchor={{ x: 0.5, y: 1 }}
          >
            <View style={{ alignItems: 'center' }}>
              {isNext && (
                <View
                  style={{
                    position: 'absolute', top: -6, left: -6,
                    width: 40, height: 40, borderRadius: 20,
                    backgroundColor: 'rgba(245,158,11,0.15)',
                    borderWidth: 1.5, borderColor: 'rgba(245,158,11,0.4)',
                  }}
                />
              )}
              <View
                style={{
                  width: 28, height: 28, borderRadius: 14,
                  backgroundColor: bg,
                  borderWidth: 2, borderColor: border,
                  alignItems: 'center', justifyContent: 'center',
                  shadowColor:   isNext ? C.orange : '#000',
                  shadowOffset:  { width: 0, height: 2 },
                  shadowOpacity: isNext ? 0.6 : 0.35,
                  shadowRadius:  isNext ? 6   : 4,
                  elevation:     isNext ? 6   : 4,
                }}
              >
                <Text style={{ color: C.white, fontSize: 11, fontWeight: '900' }}>
                  {stop.optimized_sequence_order}
                </Text>
              </View>
              <View
                style={{
                  width: 0, height: 0,
                  borderLeftWidth: 5, borderRightWidth: 5, borderTopWidth: 7,
                  borderLeftColor: 'transparent', borderRightColor: 'transparent',
                  borderTopColor: bg, marginTop: -1,
                }}
              />
            </View>
          </MapboxGL.MarkerView>
        )
      })}
    </>
  )
}

interface DriverMarkerProps {
  location:      LatLng
  heading:       number
  cameraBearing: number
}

export function DriverMarker({ location, heading, cameraBearing }: DriverMarkerProps) {
  const rotation = heading - cameraBearing

  return (
    <MapboxGL.MarkerView
      id="user-location"
      coordinate={toCoord(location)}
      anchor={{ x: 0.5, y: 0.5 }}
    >
      <View style={{ transform: [{ rotate: `${rotation}deg` }] }}>
        <View
          style={{
            width: 56, height: 56, borderRadius: 28,
            backgroundColor: 'rgba(0,229,255,0.06)',
            alignItems: 'center', justifyContent: 'center',
          }}
        >
          <View
            style={{
              width: 44, height: 44, borderRadius: 22,
              backgroundColor: 'rgba(0,229,255,0.10)',
              alignItems: 'center', justifyContent: 'center',
            }}
          >
            <View
              style={{
                width: 36, height: 36, borderRadius: 18,
                backgroundColor: C.cyan,
                alignItems: 'center', justifyContent: 'center',
                shadowColor: C.cyan, shadowOffset: { width: 0, height: 0 },
                shadowOpacity: 1, shadowRadius: 14, elevation: 12,
              }}
            >
              <Navigation2 size={20} color={C.bg} fill={C.bg} strokeWidth={1.5} />
            </View>
          </View>
        </View>
      </View>
    </MapboxGL.MarkerView>
  )
}