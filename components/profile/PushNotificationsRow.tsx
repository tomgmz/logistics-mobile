import React, { useCallback, useEffect, useState } from 'react'
import { AppState, StyleSheet, Switch, Text, TouchableOpacity, View } from 'react-native'

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
  line:  '#424242',
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
        <Text style={styles.title}>Phone notifications</Text>
        <Text style={styles.hint}>
          {on
            ? 'On. New assignments, messages and office notices pop up on this phone.'
            : 'Off. Tap to turn on, or you will only see notices inside the app.'}
        </Text>
      </View>
      {/* Shows the phone's setting; the row's tap changes it. */}
      <View pointerEvents="none">
        <Switch
          value={on}
          trackColor={{ false: C.line, true: 'rgba(77,249,237,0.35)' }}
          thumbColor={on ? C.cyan : C.faint}
        />
      </View>
    </TouchableOpacity>
  )
}

const styles = StyleSheet.create({
  row:   { flexDirection: 'row', alignItems: 'center', gap: 12 },
  text:  { flex: 1, minWidth: 0 },
  title: { color: C.white, fontSize: 16, fontFamily: FONTS.darker.medium },
  hint:  { color: C.faint, fontSize: 14, lineHeight: 19, marginTop: 3, fontFamily: FONTS.darker.regular },
})
