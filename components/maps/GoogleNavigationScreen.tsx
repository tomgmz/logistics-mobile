import React from 'react'
import { Linking, Pressable, Text, View } from 'react-native'

/**
 * Google Navigation SDK entry screen.
 *
 * This is a scaffold. The Google Navigation SDK is a gated native module
 * (`@googlemaps/react-native-navigation-sdk`) that is NOT installed yet and
 * requires an approved Navigation SDK agreement + a native dev build. Until
 * those are in place we render guidance instead of importing the SDK, so the
 * app keeps building and the custom Mapbox stack remains the default.
 *
 * To activate (full steps in docs/google-nav-sdk-migration.md):
 *   1. Get Navigation SDK access approved + an authorized key.
 *   2. Install the wrapper and add the native config / prebuild.
 *   3. Create GoogleNavigationScreenInner.tsx from the guide.
 *   4. Replace the body below with the lazy-load pattern used by
 *      NavigationScreen.tsx (dynamic import of the Inner once linked).
 */

interface GoogleNavigationScreenProps {
  bookingId: string
}

const DOCS_HINT =
  'Google Navigation SDK is not wired up yet. Follow docs/google-nav-sdk-migration.md: ' +
  'get Navigation SDK access, install @googlemaps/react-native-navigation-sdk, add the ' +
  'native config, create GoogleNavigationScreenInner, then flip EXPO_PUBLIC_NAV_PROVIDER=google.'

export default function GoogleNavigationScreen(_props: GoogleNavigationScreenProps) {
  return (
    <View
      style={{
        flex: 1,
        justifyContent: 'center',
        padding: 24,
        gap: 16,
        backgroundColor: '#0a0a0a',
      }}
    >
      <Text style={{ color: '#ffffff', fontSize: 16, fontWeight: '700', textAlign: 'center' }}>
        Google Navigation — setup required
      </Text>
      <Text style={{ color: 'rgba(255,255,255,0.7)', fontSize: 14, textAlign: 'center', lineHeight: 21 }}>
        {DOCS_HINT}
      </Text>
      <Pressable
        onPress={() => Linking.openURL('https://developers.google.com/maps/documentation/navigation')}
        style={{
          marginTop: 8,
          paddingVertical: 12,
          paddingHorizontal: 24,
          borderRadius: 12,
          borderWidth: 1,
          borderColor: 'rgba(0,229,255,0.4)',
          alignSelf: 'center',
        }}
      >
        <Text style={{ color: '#00e5ff', fontSize: 14, fontWeight: '700' }}>Open Nav SDK docs</Text>
      </Pressable>
    </View>
  )
}
