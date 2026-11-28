import React, { useCallback, useEffect, useState } from 'react'
import { AppState, StyleSheet, Text, TouchableOpacity, View } from 'react-native'

import { getPushPermission, openNotificationSettings, registerForPushNotifications } from '../../lib/push'
import { FONTS } from '../../lib/config/fonts'

/**
 * "Phone notifications" on the Profile screen (moved from the old top-bar
 * account menu, 2026-11-28). It mirrors the phone's own notification setting
 * for this app. A driver who tapped "Don't allow" on the first prompt is never
 * asked again by the phone, so tapping the row takes them straight to the
 * phone's notification settings for 8338 (or shows the prompt, if the phone
 * can still ask). Turning it off goes there too: an app cannot switch its own
 * notifications off. The switch catches up when they come back to the app.
 */

const C = {
  white: '#ffffff',
  faint: '#818181',
  cyan:  '#4df9ed',
}

export default function PushNotificationsRow() {
  const [on,   setOn]   = useState(false)
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async () => {
    const perm = await getPushPermission()
    setOn(perm.granted)
    return perm
  }, [])

  useEffect(() => {
    let wasGranted: boolean | null = null
    void refresh().then(({ granted }) => { wasGranted = granted })
    // Back from the phone's settings: if notifications were just allowed there,
    // register this phone now rather than at the next sign-in. Only on that
    // change, so an ordinary return to the app sends nothing.
    const sub = AppState.addEventListener('change', (s) => {
      if (s !== 'active') return
      void refresh().then(({ granted }) => {
        if (granted && wasGranted === false) void registerForPushNotifications()
        wasGranted = granted
      })
    })
    return () => sub.remove()
  }, [refresh])

  const onPress = async () => {
    if (busy) return
    setBusy(true)
    try {
      const perm = await getPushPermission()
      if (!perm.granted && perm.canAskAgain) {
        // The phone can still show its own prompt; this asks and registers.
        await registerForPushNotifications()
        if ((await refresh()).granted) return
      }
      await openNotificationSettings()
    } finally {
      await refresh()
      setBusy(false)
    }
  }

  return (
    <TouchableOpacity
      onPress={() => { void onPress() }}
      activeOpacity={0.75}
      accessibilityRole="switch"
      accessibilityState={{ checked: on, disabled: busy }}
      accessibilityLabel="Phone notifications"
      accessibilityHint="Opens this phone's notification settings for 8338"
      style={styles.row}
    >
      <View style={styles.text}>
        <Text style={styles.title}>PHONE NOTIFICATION</Text>
        <Text style={styles.hint}>
          {on
            ? 'On. New assignments, messages and office notices pop up on this phone.'
            : 'Off. Tap to turn on, or you will only see notices inside the app.'}
        </Text>
      </View>
      {/* Shows the phone's setting; the row's tap changes it. Figma toggle: 28×16 track, 12 px dot. */}
      <View pointerEvents="none" style={[styles.track, on ? styles.trackOn : styles.trackOff]}>
        <View style={[styles.thumb, on ? styles.thumbOn : styles.thumbOff]} />
      </View>
    </TouchableOpacity>
  )
}

const styles = StyleSheet.create({
  // Figma 2026-11-29: 12 px bold title + hint, the hint 216 px wide, toggle on the right.
  row:   { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12 },
  text:  { flexShrink: 1, maxWidth: 216, minWidth: 0 },
  title: { color: C.white, fontSize: 12, lineHeight: 15, fontFamily: FONTS.darker.bold },
  hint:  { color: C.faint, fontSize: 12, lineHeight: 13, marginTop: 4, textAlign: 'justify', fontFamily: FONTS.darker.bold },

  track:    { width: 28, height: 16, borderRadius: 10, borderWidth: 1, padding: 1, justifyContent: 'center', marginBottom: 6 },
  trackOn:  { borderColor: C.cyan, backgroundColor: 'rgba(77,249,237,0.11)', alignItems: 'flex-end' },
  trackOff: { borderColor: C.faint, backgroundColor: 'rgba(129,129,129,0.11)', alignItems: 'flex-start' },
  thumb:    { width: 12, height: 12, borderRadius: 6, borderWidth: 1 },
  thumbOn:  { backgroundColor: C.cyan, borderColor: C.cyan },
  thumbOff: { backgroundColor: C.faint, borderColor: C.faint },
})
