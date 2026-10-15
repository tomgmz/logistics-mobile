/**
 * Coach marks: the one-time hints that dim a real screen and point at one
 * control at a time.
 *
 * A target is any View tagged with useCoachTarget(id). It does not have to live
 * in the same component as the tour — the Home tour points at the top bar,
 * which belongs to the driver layout — so targets go into a module-level
 * registry and the tour looks them up by id when it runs.
 *
 * Each tour runs once per phone, like the onboarding slides, and for the same
 * reason the flag is in AsyncStorage rather than tied to the signed-in driver.
 */
import { useEffect, useRef } from 'react'
import { Dimensions, View } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'

/** How much of a target has to be on screen before a tour will point at it. */
const MIN_VISIBLE = 40

const targets = new Map<string, React.RefObject<View | null>>()

/** Tag a View as something a tour can highlight. Pass collapsable={false} on it. */
export function useCoachTarget(id: string) {
  const ref = useRef<View>(null)
  useEffect(() => {
    targets.set(id, ref)
    return () => {
      if (targets.get(id) === ref) targets.delete(id)
    }
  }, [id])
  return ref
}

export type TargetRect = { x: number; y: number; width: number; height: number }

/**
 * Where a target sits on screen right now, or null if it is not on screen.
 *
 * measure(), not measureInWindow(): on Android edge-to-edge, measureInWindow
 * subtracts the status bar, which put every highlight one status bar too high.
 * measure()'s page coordinates are from the top of the app's root view, which
 * edge-to-edge draws from the very top of the screen — the same origin as the
 * tour's status-bar-translucent modal.
 */
export function measureTarget(id: string): Promise<TargetRect | null> {
  const node = targets.get(id)?.current
  if (!node) return Promise.resolve(null)
  return new Promise((resolve) => {
    node.measure((_x, _y, width, height, x, y) => {
      // Scrolled out of view counts as absent: a ring around nothing would only
      // confuse. A sliver at the edge is not enough to point at either.
      const screenH = Dimensions.get('window').height
      const visible = Math.min(y + height, screenH) - Math.max(y, 0)
      // A small button only has to be fully on screen, not MIN_VISIBLE tall.
      resolve(width > 0 && visible >= Math.min(MIN_VISIBLE, height) ? { x, y, width, height } : null)
    })
  })
}

/** Bump a tour's version to show a rewritten tour to everyone once more. */
const tourKey = (tourId: string) => `coach_${tourId}_seen_v1`

export async function hasSeenTour(tourId: string): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(tourKey(tourId))) === '1'
  } catch {
    // Unreadable storage should never keep putting a tour in front of a driver.
    return true
  }
}

export async function markTourSeen(tourId: string): Promise<void> {
  try {
    await AsyncStorage.setItem(tourKey(tourId), '1')
  } catch {
  }
}
