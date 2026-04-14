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
    icon: './assets/icon.png',
    userInterfaceStyle: 'light',
    splash: {
      image: './assets/splash-icon.png',
      resizeMode: 'contain',
      backgroundColor: '#ffffff',
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
      adaptiveIcon: {
        foregroundImage: './assets/adaptive-icon.png',
        backgroundColor: '#ffffff',
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
          "RNMapboxMapsVersion": "11.3.0",
          "RNMapboxMapsDownloadToken": process.env.RNMAPBOX_MAPS_DOWNLOAD_TOKEN,
          "RNMapboxMapsLibs": "com.mapbox.maps:android:11.3.0;com.mapbox.mapboxsdk:mapbox-sdk-turf:6.11.0;androidx.asynclayoutinflater:asynclayoutinflater:1.0.0"
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