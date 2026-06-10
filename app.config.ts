import path from 'node:path'
import { existsSync } from 'node:fs'
import { config as loadEnv } from 'dotenv'

loadEnv({ path: path.resolve(__dirname, '.env.local') })
loadEnv({ path: path.resolve(__dirname, '..', '.env') })
loadEnv({ path: path.resolve(__dirname, '.env') })

// FCM config for Android push. Only referenced once the file is present, so
// builds keep working until you add it (Firebase Console → google-services.json).
const googleServicesFile = process.env.GOOGLE_SERVICES_JSON ?? path.resolve(__dirname, 'google-services.json')
const androidGoogleServices = existsSync(googleServicesFile) ? { googleServicesFile } : {}

export default {
  expo: {
    scheme: 'logistics-mobile',
    name: '8338 Logistics',
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
      ...androidGoogleServices,
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
      ],
      // Mapbox Navigation SDK drop-in UI (turn-by-turn). Reuses the @rnmapbox/maps
      // Maven repo + download token configured above; accessToken must be a
      // public pk. token. mapboxMapsVersion only feeds the iOS Podfile/xcframework
      // (which is built against Mapbox Maps 11.11.0); Android resolves the Maps
      // SDK from the @rnmapbox/maps libs (11.18.2) which satisfies nav-core 3.11.0.
      [
        "@badatgil/expo-mapbox-navigation",
        {
          accessToken:       process.env.EXPO_PUBLIC_MAPBOX_TOKEN,
          mapboxMapsVersion: "11.11.0",
        },
      ],
      // Google Navigation SDK requirements (Android minSdk 24, iOS 16.0).
      [
        "expo-build-properties",
        {
          android: { minSdkVersion: 24 },
          ios:     { deploymentTarget: "16.0" },
        },
      ],
      // Mandatory Android core-library desugaring for the Navigation SDK.
      "./plugins/with-google-nav",
      // Push notifications for messages.
      [
        "expo-notifications",
        {
          icon: "./assets/mobile-icon.png",
          color: "#00BCD4",
        },
      ],
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