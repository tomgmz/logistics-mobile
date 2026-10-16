import { logout } from './api/auth.api'
import { unregisterPushNotifications } from './push'
import { stopTracking } from './locationTracking'
import { endNavSession } from './navSession'
import { releaseNavigator } from './releaseNavigator'
import { useAuthStore } from './store/auth.store'
import { useAvailabilityStore } from './store/availability.store'

/**
 * Sign the driver on this phone out, and leave nothing of theirs running.
 *
 * One place for it because there are three ways to get here — the top bar, the
 * dashboard shell, and a vendor driver setting up their own account on a phone
 * someone else is signed in to — and each used to clean up a different subset.
 *
 * What it deliberately keeps: the offline queue. Entries carry the driver who
 * made them and are only sent while that driver is signed in (offlineQueue), so
 * a delivery confirmed in a dead zone survives a sign-out and goes out the next
 * time its driver signs back in on this phone.
 */
export async function signOutDriver(): Promise<void> {
  // The background position task would otherwise keep reporting the previous
  // driver's truck — with nobody's session behind it.
  await stopTracking().catch(() => {})
  // Google's navigator keeps the GPS on until it is told to let go.
  endNavSession()
  await releaseNavigator()
  try {
    await unregisterPushNotifications()
    await logout()
  } catch {
    // Offline or the session is already gone: the local sign-out below still
    // happens, and the server session expires on its own.
  } finally {
    useAuthStore.getState().clearUser()
    // Availability is per driver — drop it so the next sign-in on this device
    // doesn't show the previous driver's switch state.
    useAvailabilityStore.getState().reset()
  }
}
