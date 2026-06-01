import React, { useCallback, useEffect, useRef, useState } from 'react'
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native'
import { useRouter } from 'expo-router'
import * as Location from 'expo-location'
import {
  NavigationProvider,
  NavigationView,
  useNavigation,
  type ArrivalEvent,
  type Waypoint,
} from '@googlemaps/react-native-navigation-sdk'

import api from '../../lib/api/auth.api'
import GoogleNavOverlay from './GoogleNavOverlay'

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
  const router = useRouter()
  const {
    navigationController,
    setOnArrival,
    setOnNavigationReady,
    setOnTurnByTurn,
    setOnRouteChanged,
    removeAllListeners,
  } = useNavigation()

  const [error, setError] = useState<string | null>(null)
  const [navInfo, setNavInfo] = useState<{
    instruction: string; stepDistanceM: number; etaSeconds: number; destDistanceM: number
  } | null>(null)
  const [rerouting, setRerouting] = useState(false)
  const [legIndex,  setLegIndex]  = useState(0)
  const [totalLegs, setTotalLegs] = useState(0)

  const legsRef      = useRef<Leg[]>([])
  const legIndexRef  = useRef(0)
  const processedRef = useRef<Set<number>>(new Set())
  const waypointsRef = useRef<Waypoint[]>([])

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
    setLegIndex(idx + 1)
    // Continue to the next waypoint (returns a null waypoint if this was last).
    try { await navigationController.continueToNextDestination() } catch {}
  }, [bookingId, navigationController])

  useEffect(() => {
    let cancelled = false
    let navReady  = false
    let started   = false

    // Start guidance only once BOTH the navigator is ready and the booking's
    // waypoints have loaded. Calling setDestinations before the navigator is
    // ready throws "initialize the navigator before executing".
    const maybeBegin = async () => {
      if (cancelled || started || !navReady || waypointsRef.current.length === 0) return
      started = true
      try {
        await navigationController.setDestinations(waypointsRef.current, {
          displayOptions: { showDestinationMarkers: true },
        })
        await navigationController.startGuidance()
      } catch (e: any) {
        if (!cancelled) setError(e?.message ?? 'Failed to start guidance.')
      }
    }

    // Load the booking in PARALLEL so the Terms dialog isn't gated behind this
    // network round-trip. Never rejects — errors are captured for the main flow.
    let bookingError: any = null
    const loadBooking = (async () => {
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
        if (__DEV__) {
          console.log('[gnav] booking status:', booking.status, 'pickedUp:', pickedUp)
          console.log('[gnav] raw destinations:', JSON.stringify(
            (booking.booking_destinations ?? []).map((d: any) => ({
              seq: d.sequence_order, status: d.status, lat: d.latitude, lng: d.longitude,
            })),
          ))
          console.log('[gnav] waypoints sent:', waypoints.length, JSON.stringify(waypoints.map((w) => w.title)))
        }

        if (waypoints.length === 0) {
          bookingError = new Error('No stops with coordinates to navigate. Run route optimization first.')
          return
        }

        waypointsRef.current = waypoints
        legsRef.current      = legs
        legIndexRef.current  = 0
        processedRef.current = new Set()
        setTotalLegs(waypoints.length)
        setLegIndex(0)
      } catch (e: any) {
        bookingError = e
      }
    })()

    ;(async () => {
      try {
        // The Navigation SDK requires location permission to render/guide.
        const { status } = await Location.requestForegroundPermissionsAsync()
        if (status !== 'granted') {
          if (!cancelled) setError('Location permission is required for navigation. Enable it in Settings, then reopen.')
          return
        }

        // Register listeners BEFORE init so onNavigationReady isn't missed.
        setOnArrival(handleArrival)
        setOnNavigationReady(() => { navReady = true; maybeBegin() })
        setOnTurnByTurn((events: any[]) => {
          const e = events?.[0]
          if (!e || cancelled) return
          setNavInfo({
            instruction:   e.currentStep?.instruction ?? '',
            stepDistanceM: e.distanceToCurrentStepMeters ?? 0,
            etaSeconds:    e.timeToFinalDestinationSeconds ?? 0,
            destDistanceM: e.distanceToFinalDestinationMeters ?? 0,
          })
        })
        setOnRouteChanged(() => {
          if (cancelled) return
          setRerouting(true)
          setTimeout(() => { if (!cancelled) setRerouting(false) }, 2500)
        })

        // Show Terms immediately — independent of the booking fetch.
        const accepted = await navigationController.areTermsAccepted()
        if (!accepted) await navigationController.showTermsAndConditionsDialog()
        if (cancelled) return

        await navigationController.init()

        // Now wait for the (parallel) booking load, then start guidance.
        await loadBooking
        if (cancelled) return
        if (bookingError) {
          setError(bookingError?.response?.data?.message ?? bookingError?.message ?? 'Failed to load booking.')
          return
        }
        await maybeBegin()
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

  return (
    <View style={{ flex: 1, backgroundColor: '#0a0a0a' }}>
      <NavigationView
        style={StyleSheet.absoluteFill}
        mapId={process.env.EXPO_PUBLIC_GOOGLE_MAPS_MAP_ID}
        // Hide Google's built-in chrome but keep its guidance camera + route.
        headerEnabled={false}
        footerEnabled={false}
        speedometerEnabled={false}
        speedLimitIconEnabled={false}
        recenterButtonEnabled={false}
        reportIncidentButtonEnabled={false}
        tripProgressBarEnabled={false}
        trafficPromptsEnabled={false}
        trafficIncidentCardsEnabled={false}
      />
      <GoogleNavOverlay
        instruction={navInfo?.instruction}
        stepDistanceM={navInfo?.stepDistanceM}
        etaSeconds={navInfo?.etaSeconds}
        destDistanceM={navInfo?.destDistanceM}
        rerouting={rerouting}
        current={legIndex + 1}
        total={totalLegs}
        onBack={() => router.back()}
      />
    </View>
  )
}
