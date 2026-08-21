import React, { useEffect, useState } from 'react'
import { ActivityIndicator, Linking, Pressable, Text, View } from 'react-native'

/**
 * Google Navigation SDK entry screen.
 *
 * Lazy-loads the real SDK screen so the app keeps working even when the native
 * module isn't present yet (e.g. before `expo prebuild` + a dev build, or in
 * Expo Go). If the dynamic import fails — which is what happens when the
 * TurboModule isn't linked — we show setup guidance instead of crashing.
 *
 * Full setup steps: docs/google-nav-sdk-migration.md
 */

interface Props {
  bookingId:  string
  routeToken?: string | null
  /** The driver chose to run this ahead of its scheduled day. */
  earlyStart?: boolean
}

const SETUP_HINT =
  'Google Navigation SDK native module not found. Run `npx expo prebuild --clean` then ' +
  '`npx expo run:android` (or EAS Build for iOS) with the SDK configured, and make sure ' +
  'Navigation SDK access is enabled on your Google key. See docs/google-nav-sdk-migration.md.'

export default function GoogleNavigationScreen({ bookingId, routeToken, earlyStart = false }: Props) {
  const [Inner, setInner] = useState<React.ComponentType<Props> | null>(null)
  const [loadErr, setLoadErr] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    import('./GoogleNavigationScreenInner')
      .then((m) => { if (!cancelled) setInner(() => m.default) })
      .catch(() => { if (!cancelled) setLoadErr(SETUP_HINT) })
    return () => { cancelled = true }
  }, [])

  if (loadErr) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', padding: 24, gap: 16, backgroundColor: '#0a0a0a' }}>
        <Text style={{ color: '#ffffff', fontSize: 16, fontWeight: '700', textAlign: 'center' }}>
          Google Navigation — setup required
        </Text>
        <Text style={{ color: 'rgba(255,255,255,0.7)', fontSize: 14, textAlign: 'center', lineHeight: 21 }}>
          {loadErr}
        </Text>
        <Pressable
          onPress={() => Linking.openURL('https://developers.google.com/maps/documentation/navigation')}
          style={{
            marginTop: 8, paddingVertical: 12, paddingHorizontal: 24, borderRadius: 12,
            borderWidth: 1, borderColor: 'rgba(0,229,255,0.4)', alignSelf: 'center',
          }}
        >
          <Text style={{ color: '#00e5ff', fontSize: 14, fontWeight: '700' }}>Open Nav SDK docs</Text>
        </Pressable>
      </View>
    )
  }

  if (!Inner) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#0a0a0a' }}>
        <ActivityIndicator size="large" color="#00e5ff" />
      </View>
    )
  }

  return <Inner bookingId={bookingId} routeToken={routeToken} earlyStart={earlyStart} />
}
