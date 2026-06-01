/**
 * Runtime feature flags.
 *
 * NAV_PROVIDER selects which driver navigation stack renders for the
 * `/driver/maps/[bookingId]` route:
 *
 *   - 'mapbox' (default): the existing custom stack — Google Routes API for
 *     routing/traffic + Mapbox tiles/offline + our own snapping/rerouting.
 *     This is the proven, offline-capable path and the safe fallback.
 *
 *   - 'google': the Google Navigation SDK turn-by-turn engine (native
 *     snapping, voice, auto-reroute). Requires the gated Navigation SDK
 *     agreement + an authorized key + a native dev build. See
 *     docs/google-nav-sdk-migration.md.
 *
 * Set EXPO_PUBLIC_NAV_PROVIDER=google in .env.local to trial the Google stack.
 * Leaving it unset (or anything other than 'google') keeps the custom stack,
 * so this flag defaults to the working behavior and is the rollback switch.
 */
export type NavProvider = 'mapbox' | 'google'

export function getNavProvider(): NavProvider {
  return process.env.EXPO_PUBLIC_NAV_PROVIDER === 'google' ? 'google' : 'mapbox'
}
