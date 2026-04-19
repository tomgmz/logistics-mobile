/**
 * Lazy entry for the driver map screen. The real implementation lives in
 * `NavigationScreenMapInner.tsx` and is loaded with `import()` so Expo Router
 * does not evaluate `@rnmapbox/maps` while scanning routes (and so Expo Go
 * shows a message instead of crashing the whole app).
 */

import Constants, { ExecutionEnvironment } from 'expo-constants'
import React, { useEffect, useState } from 'react'
import { ActivityIndicator, NativeModules, Platform, Text, View } from 'react-native'

function isMapboxNativeLinked(): boolean {
  const mod = NativeModules.RNMBXModule as { setAccessToken?: unknown } | null | undefined
  // A bare truthy object is not enough — the real bridge exposes native methods.
  return mod != null && typeof mod.setAccessToken === 'function'
}

interface NavigationScreenProps {
  bookingId: string
}

export default function NavigationScreen({ bookingId }: NavigationScreenProps) {
  const [Inner, setInner] =
    useState<React.ComponentType<NavigationScreenProps> | null>(null)
  const [loadErr, setLoadErr] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    // Never load @rnmapbox/maps JS in Expo Go — it throws during module init.
    if (Constants.executionEnvironment === ExecutionEnvironment.StoreClient) {
      setLoadErr(
        'Maps are not available in Expo Go. Create a development build with Mapbox included (eas build -p ios on a cloud Mac, or npx expo run:android on Windows), then install that build on your device.',
      )
      return
    }

    if (!isMapboxNativeLinked()) {
      const iosHint =
        Platform.OS === 'ios'
          ? ' On Windows you cannot run npx expo run:ios locally; use EAS Build (eas build -p ios) or a Mac to produce an iOS binary with @rnmapbox/maps linked.'
          : ''
      setLoadErr(
        `Maps need a native build with Mapbox linked. Run npx expo run:${Platform.OS} after prebuild, or use EAS Build — not Expo Go.${iosHint} Rebuild after changing native dependencies.`,
      )
      return
    }

    import('./NavigationScreenMapInner')
      .then((m) => {
        if (!cancelled) setInner(() => m.default)
      })
      .catch(() => {
        if (!cancelled) {
          setLoadErr(
            'Could not load the map screen. Rebuild the app with @rnmapbox/maps configured (see Expo Mapbox install docs).',
          )
        }
      })
    return () => {
      cancelled = true
    }
  }, [])

  if (loadErr) {
    return (
      <View
        style={{
          flex:            1,
          justifyContent: 'center',
          padding:         24,
          backgroundColor: '#0a0a0a',
        }}
      >
        <Text style={{ color: '#ffffff', fontSize: 15, textAlign: 'center', lineHeight: 22 }}>
          {loadErr}
        </Text>
      </View>
    )
  }

  if (!Inner) {
    return (
      <View
        style={{
          flex:            1,
          justifyContent: 'center',
          alignItems:      'center',
          backgroundColor: '#0a0a0a',
        }}
      >
        <ActivityIndicator color="#00e5ff" size="large" />
      </View>
    )
  }

  return <Inner bookingId={bookingId} />
}
