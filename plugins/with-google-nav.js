/**
 * Custom Expo config plugin for the Google Navigation SDK.
 *
 * The SDK does NOT ship an Expo config plugin, so this injects the one native
 * requirement that expo-build-properties can't: Android core-library
 * desugaring (mandatory per the SDK install docs).
 *
 * minSdkVersion (24) and the iOS deployment target (16.0) are handled by
 * expo-build-properties in app.config.ts. The Android API key is already
 * injected via app.config's `android.config.googleMaps.apiKey`
 * (com.google.android.geo.API_KEY meta-data).
 *
 * ⚠️ Verify with `npx expo prebuild --clean` — the regex anchors assume the
 * standard Expo-generated app/build.gradle structure.
 */
const { withAppBuildGradle } = require('@expo/config-plugins')

const DESUGAR_DEP = "com.android.tools:desugar_jdk_libs_nio:2.0.4"

function addDesugaring(contents) {
  let next = contents

  if (!next.includes('coreLibraryDesugaringEnabled')) {
    next = next.replace(
      /compileOptions\s*\{/,
      'compileOptions {\n        coreLibraryDesugaringEnabled true',
    )
  }

  if (!next.includes('desugar_jdk_libs')) {
    next = next.replace(
      /dependencies\s*\{/,
      `dependencies {\n    coreLibraryDesugaring '${DESUGAR_DEP}'`,
    )
  }

  return next
}

module.exports = function withGoogleNav(config) {
  return withAppBuildGradle(config, (cfg) => {
    if (cfg.modResults.language === 'groovy') {
      cfg.modResults.contents = addDesugaring(cfg.modResults.contents)
    }
    return cfg
  })
}
