/**
 * Runtime navigation-provider selection.
 *
 * Both the Google Navigation SDK and the Mapbox Navigation SDK drop-in
 * (components/maps/mapbox/MapboxNavSDKScreen) are linked into the same native
 * build, so flipping this env var and reloading JS switches providers without a
 * native rebuild. Default is `google` (current production behavior); set
 * EXPO_PUBLIC_NAV_PROVIDER=mapbox to use the Mapbox Navigation SDK turn-by-turn.
 */

export type NavProvider = 'google' | 'mapbox'

export function getNavProvider(): NavProvider {
  return process.env.EXPO_PUBLIC_NAV_PROVIDER === 'mapbox' ? 'mapbox' : 'google'
}
