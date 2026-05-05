import path from 'node:path'
import { config as loadEnv } from 'dotenv'

loadEnv({ path: path.resolve(__dirname, '..', '.env') })
loadEnv({ path: path.resolve(__dirname, '.env') })

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
    icon: './assets/mobile-icon.png',
    userInterfaceStyle: 'dark',
    splash: {
      image: './assets/splash-icon.png',
      resizeMode: 'contain',
      backgroundColor: '#242424',
    },
    ios: {
      supportsTablet: true,
      bundleIdentifier: 'ph.logistics8338.mobile',
      buildNumber: '1',
      config: {
        googleMapsApiKey: process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY,
      },
      "infoPlist": {
      "ITSAppUsesNonExemptEncryption": false
    }
    },
    android: {
      package: 'ph.logistics8338.mobile',
      versionCode: 1,
      targetSdkVersion: 34,
      "ndkVersion": "27.1.12297006",
      softwareKeyboardLayoutMode: "resize",
      adaptiveIcon: {
        foregroundImage: './assets/mobile-icon.png',
        backgroundColor: '#242424',
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
      [
        "@rnmapbox/maps",
        {
          "RNMapboxMapsImpl": "mapbox",
          "RNMapboxMapsVersion": "11.18.2",
          "RNMAPBOX_MAPS_DOWNLOAD_TOKEN":
            process.env.RNMAPBOX_MAPS_DOWNLOAD_TOKEN ?? process.env.MAPBOX_DOWNLOADS_TOKEN,
          "RNMapboxMapsLibs":
            "com.mapbox.maps:android:11.18.2;com.mapbox.mapboxsdk:mapbox-sdk-turf:6.11.0;androidx.asynclayoutinflater:asynclayoutinflater:1.0.0",
        }
      ]
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