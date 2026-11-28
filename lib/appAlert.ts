import type { AlertButton, AlertOptions } from 'react-native'

/**
 * The app's own pop-up, in place of the native one (user 2026-11-28: the grey
 * Android box didn't match the Figma pop-ups, e.g. "MARK THIS DELIVERY AS DONE?").
 *
 * Same arguments as `Alert.alert`, so every call site is a one-word swap and
 * keeps its buttons, styles and callbacks. It can be called from anywhere —
 * screens, the offline queue, location tracking — because it only puts the
 * pop-up in a queue; components/ui/AppAlertHost (mounted once in the root
 * layout) draws it.
 *
 * Like the native one on Android: tapping outside or Back closes it only when
 * `cancelable: true` is passed, and calls `onDismiss`. Pop-ups raised while one
 * is open wait their turn instead of stacking.
 */

export interface AppAlert {
  id:       number
  title:    string
  message?: string
  buttons:  AlertButton[]
  options?: AlertOptions
}

type Listener = (current: AppAlert | null) => void

let queue: AppAlert[] = []
let nextId = 1
const listeners = new Set<Listener>()

function emit() {
  const current = queue[0] ?? null
  for (const l of listeners) l(current)
}

export function appAlert(
  title: string,
  message?: string,
  buttons?: AlertButton[],
  options?: AlertOptions,
): void {
  queue = [...queue, {
    id: nextId++,
    title,
    message,
    // No buttons = one OK, as the native alert does.
    buttons: buttons && buttons.length > 0 ? buttons : [{ text: 'OK' }],
    options,
  }]
  emit()
}

/** Closes the pop-up on screen, then runs what was pressed (which may raise the next one). */
export function closeAppAlert(id: number, then?: () => void): void {
  if (queue[0]?.id !== id) return
  queue = queue.slice(1)
  emit()
  try { then?.() } catch (e) { console.error('[appAlert] button handler failed', e) }
}

export function subscribeAppAlert(listener: Listener): () => void {
  listeners.add(listener)
  listener(queue[0] ?? null)
  return () => { listeners.delete(listener) }
}
