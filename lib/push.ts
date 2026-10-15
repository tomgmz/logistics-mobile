import { Platform } from 'react-native'
import Constants from 'expo-constants'
import * as Device from 'expo-device'
import * as Notifications from 'expo-notifications'
import { router } from 'expo-router'
import api from './api/auth.api'

/**
 * Tracks the conversation/group the user is currently viewing so foreground
 * notifications for that same chat can be suppressed. Set by the chat screens.
 */
let activeChatId: string | null = null
export function setActiveChat(id: string | null): void {
  activeChatId = id
}

function isViewing(data: Record<string, unknown> | undefined): boolean {
  if (!data || activeChatId == null) return false
  return data.conversation_id === activeChatId || data.group_id === activeChatId
}

// Show banners while foregrounded unless the user is already on that chat.
Notifications.setNotificationHandler({
  handleNotification: async (notification) => {
    const data = notification.request.content.data as Record<string, unknown> | undefined
    const show = !isViewing(data)
    return {
      shouldShowBanner: show,
      shouldShowList:   show,
      shouldPlaySound:  show,
      shouldSetBadge:   false,
    }
  },
})

let lastToken: string | null = null

function getProjectId(): string | undefined {
  return (
    Constants.expoConfig?.extra?.eas?.projectId ??
    (Constants as unknown as { easConfig?: { projectId?: string } }).easConfig?.projectId
  )
}

/**
 * Request permission, obtain the Expo push token, and register it with the
 * backend. No-op on simulators/web. Safe to call repeatedly.
 */
export async function registerForPushNotifications(): Promise<void> {
  try {
    if (Platform.OS === 'web' || !Device.isDevice) return

    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('messages', {
        name: 'Messages',
        importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#00BCD4',
      })
    }

    const existing = await Notifications.getPermissionsAsync()
    let status = existing.status
    if (status !== 'granted') {
      status = (await Notifications.requestPermissionsAsync()).status
    }
    if (status !== 'granted') return

    const projectId = getProjectId()
    const { data: token } = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined
    )
    if (!token) return
    // Always tell the server, even when the token is unchanged. This runs once
    // per sign-in, and the phone's token stays the same across accounts: if a
    // previous driver's sign-out never reached the server (no signal, an expired
    // session), skipping this left the phone registered to THEM, so it kept
    // getting their notifications (a booking assigned to one driver alerting
    // another on the same phone). Registering moves the token to whoever is
    // signed in now.
    lastToken = token

    await api.post('/notifications/push/subscribe', {
      platform: 'expo',
      token,
      device_info: `${Device.modelName ?? 'device'} — ${Platform.OS} ${Platform.Version}`,
    })
  } catch (err) {
    console.warn('[push] register failed', err)
  }
}

/** Remove this device's token from the backend (call on logout). */
export async function unregisterPushNotifications(): Promise<void> {
  const token = lastToken
  // Forget it either way: the next sign-in registers this phone afresh.
  lastToken = null
  try {
    if (!token) return
    await api.post('/notifications/push/unsubscribe', { token })
  } catch (err) {
    console.warn('[push] unregister failed', err)
  }
}

function routeFromNotification(data: Record<string, unknown> | undefined): void {
  if (!data) return
  // Booking workflow notifications (e.g. 'booking.assigned') deep-link to the
  // specific booking; fall back to the assignment list if the id is missing.
  if (typeof data.type === 'string' && data.type.startsWith('booking.')) {
    const bookingId = typeof data.booking_id === 'string' ? data.booking_id : null
    if (bookingId) {
      router.push({ pathname: '/driver/maps/[bookingId]', params: { bookingId } })
    } else {
      router.push('/driver/driver-assignment')
    }
    return
  }
  // License expiry reminder: open the list, where the full notice is shown.
  if (data.type === 'driver.license_expiring') {
    router.push('/driver/notifications')
    return
  }
  // Chat notifications.
  if (data.type === 'group' && data.group_id) {
    router.push(`/driver/messages/group/${data.group_id}`)
  } else if (data.conversation_id) {
    router.push(`/driver/messages/${data.conversation_id}`)
  }
}

// A tap that launches the app arrives before the start screen has routed:
// opening the chat then was undone a moment later by the start screen's own
// redirect to Home. So until `markNavigationReady` the tap is held and opened
// on top of Home afterwards (Back then returns to Home, as a warm tap does).
let navigationReady = false
let pendingTap: Record<string, unknown> | undefined
// The cold-start tap can be reported by both the listener and
// getLastNotificationResponseAsync; each notification opens once.
const handledTaps = new Set<string>()

function onTap(response: Notifications.NotificationResponse): void {
  const id = response.notification.request.identifier
  if (handledTaps.has(id)) return
  handledTaps.add(id)
  // Otherwise the next launch reports the same old tap again.
  try { Notifications.clearLastNotificationResponse() } catch { /* older native build */ }

  const data = response.notification.request.content.data as Record<string, unknown> | undefined
  if (navigationReady) routeFromNotification(data)
  else pendingTap = data
}

/**
 * Called by the start screen once it has sent the user to their home screen.
 * Opens a notification tap that launched the app, if there was one.
 */
export function markNavigationReady(): void {
  if (navigationReady) return
  navigationReady = true
  const data = pendingTap
  pendingTap = undefined
  // After the redirect that was just issued has been applied.
  if (data) setTimeout(() => routeFromNotification(data), 0)
}

/**
 * Wire notification-tap handling. Returns a cleanup function. Call once the user
 * is signed in (e.g. from the root layout).
 */
export function initPushResponders(): () => void {
  const sub = Notifications.addNotificationResponseReceivedListener(onTap)

  // Handle a tap that launched the app from a cold start.
  Notifications.getLastNotificationResponseAsync().then((response) => {
    if (response) onTap(response)
  })

  return () => sub.remove()
}
