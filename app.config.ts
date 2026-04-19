import 'dotenv/config'

export default {
  expo: {
    scheme: 'logistics-mobile',
    name: 'logistics-mobile',
    slug: 'logistics-mobile',
    version: '1.0.0',
    runtimeVersion: {
      policy: 'appVersion',
    },
    orientation: 'portrait',
    icon: './assets/app-logo.png',
    userInterfaceStyle: 'light',
    splash: {
      image: './assets/Final_Logo.png', 
      resizeMode: 'contain',
      backgroundColor: '#000000',
    },
    ios: {
      supportsTablet: true,
      bundleIdentifier: 'ph.logistics8338.mobile',
      buildNumber: '1',
      config: {
        googleMapsApiKey: process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY,
      },
      infoPlist: {
        ITSAppUsesNonExemptEncryption: false,
      },
    },
    android: {
      package: 'ph.logistics8338.mobile',
      versionCode: 1,
      targetSdkVersion: 34,
      adaptiveIcon: {
        foregroundImage: './assets/app-logo.png',
        backgroundColor: '#000000',
      },
      predictiveBackGestureEnabled: false,
      config: {
        googleMaps: {
          apiKey: process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY,
        },
      },
    },
    web: {
      favicon: './assets/favicon.png',
      bundler: 'metro',
    },
    plugins: [
      'expo-router',
      'expo-font',
      'expo-secure-store',
      ['@maplibre/maplibre-react-native'],
    ],
    extra: {
      eas: {
        projectId: '2c58aa25-ccbe-4c89-bd86-936677c96566',
      },
    },
    updates: {
      url: 'https://u.expo.dev/2c58aa25-ccbe-4c89-bd86-936677c96566',
    },
  },
}