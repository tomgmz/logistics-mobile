import React, { useCallback, useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Text, View } from 'react-native'
import {
  NavigationProvider,
  NavigationView,
  useNavigation,
  type ArrivalEvent,
  type Waypoint,
} from '@googlemaps/react-native-navigation-sdk'

import api from '../../lib/api/auth.api'

/**
 * Real Google Navigation SDK screen. Loaded lazily by GoogleNavigationScreen
 * only when EXPO_PUBLIC_NAV_PROVIDER=google AND the native module is present
 * (i.e. after a prebuild/dev build with the SDK configured).
 *
 * The SDK owns routing, snapping, voice and rerouting. Our only jobs are:
 *   1. Feed it waypoints from the backend (GET /booking/:id).
 *   2. Translate its arrival events back into our booking status PATCHes.
 *
 * Waypoints carry no custom metadata, so arrivals are mapped to stops by their
 * sequence index (navigation is strictly ordered via continueToNextDestination).
 */

interface Props {
  bookingId: string
}

const TOS_OPTIONS = {
  title:       '8338 Logistics Navigation',
  companyName: '8338 Logistics',
}

type Leg =
  | { type: 'pickup' }
  | { type: 'dropoff'; destinationId: string }

export default function GoogleNavigationScreenInner({ bookingId }: Props) {
  return (
    <NavigationProvider termsAndConditionsDialogOptions={TOS_OPTIONS}>
      <GoogleNavInner bookingId={bookingId} />
    </NavigationProvider>
  )
}

function GoogleNavInner({ bookingId }: Props) {
  const { navigationController, setOnArrival, removeAllListeners } = useNavigation()

  const [error, setError] = useState<string | null>(null)

  const legsRef      = useRef<Leg[]>([])
  const legIndexRef  = useRef(0)
  const processedRef = useRef<Set<number>>(new Set())

  const handleArrival = useCallback(async (_event: ArrivalEvent) => {
    const idx = legIndexRef.current
    const leg = legsRef.current[idx]

    // Guard against duplicate arrival callbacks for the same leg.
    if (!leg || processedRef.current.has(idx)) {
      try { await navigationController.continueToNextDestination() } catch {}
      return
    }
    processedRef.current.add(idx)

    if (leg.type === 'pickup') {
      api.patch(`/booking/${bookingId}/status`, { status: 'in_transit' }).catch(() => {})
    } else {
      api
        .patch(`/booking-destinations/${leg.destinationId}/status`, { status: 'delivered' })
        .catch(() => {})
    }

    legIndexRef.current = idx + 1
    // Continue to the next waypoint (returns a null waypoint if this was last).
    try { await navigationController.continueToNextDestination() } catch {}
  }, [bookingId, navigationController])

  useEffect(() => {
    let cancelled = false

    ;(async () => {
      try {
        const { data } = await api.get(`/booking/${bookingId}`)
        const booking = data.data

        const pickedUp = ['in_transit', 'completed'].includes(booking.status)

        const stops = (booking.booking_destinations ?? [])
          .filter((d: any) => d.latitude != null && d.longitude != null && d.status === 'pending')
          .sort((a: any, b: any) => a.sequence_order - b.sequence_order)

        const waypoints: Waypoint[] = []
        const legs:      Leg[]      = []

        if (!pickedUp && booking.origin_latitude != null && booking.origin_longitude != null) {
          waypoints.push({ title: 'Pickup', position: { lat: booking.origin_latitude, lng: booking.origin_longitude } })
          legs.push({ type: 'pickup' })
        }
        for (const s of stops) {
          waypoints.push({ title: s.address ?? 'Stop', position: { lat: s.latitude, lng: s.longitude } })
          legs.push({ type: 'dropoff', destinationId: s.destination_id })
        }

        if (waypoints.length === 0) {
          if (!cancelled) setError('No stops with coordinates to navigate. Run route optimization first.')
          return
        }

        legsRef.current      = legs
        legIndexRef.current  = 0
        processedRef.current = new Set()

        // Terms of Service must be accepted before init().
        const accepted = await navigationController.areTermsAccepted()
        if (!accepted) await navigationController.showTermsAndConditionsDialog()
        if (cancelled) return

        await navigationController.init()
        if (cancelled) return

        setOnArrival(handleArrival)

        await navigationController.setDestinations(waypoints)
        await navigationController.startGuidance()
      } catch (e: any) {
        if (!cancelled) {
          setError(e?.response?.data?.message ?? e?.message ?? 'Failed to start navigation.')
        }
      }
    })()

    return () => {
      cancelled = true
      removeAllListeners()
      navigationController.stopGuidance().catch(() => {})
      navigationController.cleanup().catch(() => {})
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookingId])

  if (error) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: '#0a0a0a' }}>
        <Text style={{ color: '#ef4444', fontSize: 14, textAlign: 'center', lineHeight: 21 }}>{error}</Text>
      </View>
    )
  }

  return <NavigationView style={{ flex: 1 }} />
}
