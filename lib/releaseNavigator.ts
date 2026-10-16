import { TurboModuleRegistry } from 'react-native'

/**
 * Release Google's navigator from outside the map screen.
 *
 * The navigator outlives the map on purpose — leaving the map must not stop
 * guidance (see navSession). The flip side is that nothing on the map screen
 * releases it once the driver is done with the app: after a delivery and a
 * sign-out it was still holding the GPS at high accuracy, once a second, for
 * as long as the app stayed alive. Signing out is "done with the app", so this
 * runs there.
 *
 * Looked up by name, not imported: importing the navigation SDK here would pull
 * the native module into every screen that can sign out, and a build without it
 * (Expo Go) would crash on load. `get` (not `getEnforcing`) simply returns null
 * there.
 */
interface NavModuleLike {
  cleanup?: () => Promise<unknown>
}

export async function releaseNavigator(): Promise<void> {
  const mod = TurboModuleRegistry.get<NavModuleLike & import('react-native').TurboModule>('NavModule')
  if (!mod?.cleanup) return
  // Rejects with "no navigator" when none was ever started — nothing to release.
  await mod.cleanup().catch(() => {})
}
