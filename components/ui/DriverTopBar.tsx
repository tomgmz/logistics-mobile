/**
 * The driver app's top bar, built from the Figma "Home" frame (node 2727:1297):
 * the 8338 wordmark on the left, then message, notification and profile
 * circles on the right.
 *
 * There is no sidebar behind it, so this bar carries the whole chrome: the
 * wordmark is the way home, screens below home get a back chevron, and the
 * profile circle opens the full-page Profile screen (2026-11-28; before that a
 * small drop-down menu: phone notifications, passkey setup, sign out — all of
 * which now live on that page).
 */
import React from 'react'
import { View, Text, Image, TouchableOpacity, StyleSheet } from 'react-native'
import { MotiView } from 'moti'
import { useRouter, usePathname } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Bell, MessageCircle, ChevronLeft } from 'lucide-react-native'

import { useAuthStore } from '../../lib/store/auth.store'
import { useMessagingStore } from '../../lib/store/messaging.store'
import { useNotificationStore } from '../../lib/store/notification.store'
import { FONTS } from '../../lib/config/fonts'
import { useCoachTarget } from '../../lib/coachMarks'

const logoImg = require('../../assets/Final_Logo.png')

const HOME_ROUTE    = '/driver/home'
const PROFILE_ROUTE = '/driver/profile'

/**
 * Screens that trade the wordmark for their own name in the bar, per the
 * "My Assignments" frame (node 2734:1475). Anything not listed keeps the
 * wordmark and just gains a back chevron.
 */
const TITLES: Record<string, string> = {
  // "Assignments", not "My Assignments" (user 2026-11-27).
  '/driver/driver-assignment': 'Assignments',
  // "Maintenance" was the wrong name for this: most of what a driver raises
  // mid-route is an accident, a hold-up or a colleague who has collapsed, and
  // filing those under maintenance told them the screen was not for them.
  '/driver/reports':           'Reports',
  '/driver/passkeys':          'Passkey Setup',
  '/driver/profile':           'Profile',
  '/driver/user-guide':        'User Guide',
}

const COLORS = {
  bg:        '#000000',
  titledBg:  '#0e1010',
  titledLine:'#424242',
  circle:    '#343434',
  avatar:    '#000000',
  white:     '#ffffff',
  cyan:      '#4df9ed',
}

/** Design geometry: 35px circles, 5px apart, sitting just under the status bar. */
const CIRCLE   = 35
const BAR_GAP  = 5
const BAR_TOP  = 10

export default function DriverTopBar() {
  const insets   = useSafeAreaInsets()
  const router   = useRouter()
  const pathname = usePathname()

  const user         = useAuthStore((s) => s.user)
  const totalUnread  = useMessagingStore((s) => s.totalUnread)
  const unreadNotifs = useNotificationStore((s) => s.unreadCount)

  // The Home tour points at these three buttons.
  const actionsTarget = useCoachTarget('topbar.actions')

  const isHome    = pathname === HOME_ROUTE
  const isProfile = pathname === PROFILE_ROUTE
  const title     = TITLES[pathname]

  const displayName =
    user?.first_name && user?.last_name
      ? `${user.first_name} ${user.last_name}`
      : user?.username ?? 'Driver'

  // "D1" in the design — a driver reads their own badge faster than one letter.
  const initials = (
    (user?.first_name?.[0] ?? '') + (user?.last_name?.[0] ?? '')
  ).toUpperCase() || user?.username?.[0]?.toUpperCase() || '?'

  return (
    <>
      <MotiView
        from={{ translateY: -24, opacity: 0 }}
        animate={{ translateY: 0, opacity: 1 }}
        transition={{ type: 'timing', duration: 420 }}
        style={[
          styles.bar,
          { paddingTop: insets.top + BAR_TOP },
          // Titled screens sit on their own plate with a divider; home floats
          // straight on the black background.
          title ? styles.barTitled : null,
        ]}
      >
        <View style={[styles.left, title ? styles.leftTitled : null]}>
          {!isHome && (
            <TouchableOpacity
              onPress={() => (router.canGoBack() ? router.back() : router.replace(HOME_ROUTE))}
              activeOpacity={0.7}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 6 }}
              accessibilityRole="button"
              accessibilityLabel="Go back"
              style={styles.backBtn}
            >
              <ChevronLeft size={24} color={COLORS.white} />
            </TouchableOpacity>
          )}

          {title ? (
            <Text style={styles.title} numberOfLines={1}>{title}</Text>
          ) : (
            <TouchableOpacity
              // navigate (not push) so tapping the wordmark returns to the home
              // already in the stack instead of piling up copies of it.
              onPress={() => router.navigate(HOME_ROUTE)}
              activeOpacity={0.8}
              disabled={isHome}
              accessibilityRole="button"
              accessibilityLabel="8338 Logistics Services, go to home"
            >
              <Image source={logoImg} style={styles.logo} resizeMode="contain" />
            </TouchableOpacity>
          )}
        </View>

        <View ref={actionsTarget} collapsable={false} style={styles.right}>
          <CircleButton
            label="Messages"
            badge={totalUnread}
            onPress={() => router.push('/driver/messages')}
          >
            <MessageCircle size={17} color={COLORS.white} />
          </CircleButton>

          <CircleButton
            label="Notifications"
            badge={unreadNotifs}
            onPress={() => router.push('/driver/notifications')}
          >
            <Bell size={17} color={COLORS.white} />
          </CircleButton>

          <TouchableOpacity
            // navigate (not push): tapping the circle again from Passkey Setup
            // returns to the Profile already in the stack.
            onPress={() => router.navigate(PROFILE_ROUTE)}
            disabled={isProfile}
            activeOpacity={0.75}
            accessibilityRole="button"
            accessibilityLabel={`Profile for ${displayName}`}
            accessibilityState={{ selected: isProfile }}
            // On the Profile screen the circle takes the cyan ring, as the web's
            // sidebar avatar does on its Profile page.
            style={[styles.avatar, isProfile && styles.avatarActive]}
          >
            <Text style={styles.avatarText}>{initials}</Text>
          </TouchableOpacity>
        </View>
      </MotiView>
    </>
  )
}

function CircleButton({
  children, label, badge, onPress,
}: {
  children: React.ReactNode
  label:    string
  badge:    number
  onPress:  () => void
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.75}
      accessibilityRole="button"
      accessibilityLabel={badge > 0 ? `${label}, ${badge} unread` : label}
      style={styles.circleBtn}
    >
      {children}
      {badge > 0 && (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{badge > 9 ? '9+' : badge}</Text>
        </View>
      )}
    </TouchableOpacity>
  )
}


const styles = StyleSheet.create({
  bar: {
    flexDirection:   'row',
    alignItems:      'center',
    justifyContent:  'space-between',
    paddingLeft:     17,
    paddingRight:    24,
    paddingBottom:   12,
    backgroundColor: COLORS.bg,
    zIndex:          50,
  },

  barTitled: {
    backgroundColor:   COLORS.titledBg,
    borderBottomWidth: 0.5,
    borderBottomColor: COLORS.titledLine,
  },

  left: {
    flexDirection: 'row',
    alignItems:    'center',
    gap:           4,
    flexShrink:    1,
  },
  // Lands the chevron at x=10 and the title at x=38, as the design has them
  // (17 padding − 3 here − 4 on the button = 10; + 24 icon + 4 gap = 38).
  leftTitled: {
    marginLeft: -3,
  },
  backBtn: {
    marginLeft: -4,
  },
  // 130 × 33 is the wordmark's box in the design (290:74 aspect).
  logo: {
    width:  130,
    height: 33,
  },
  title: {
    color:      COLORS.white,
    fontSize:   22,
    fontFamily: FONTS.spartan.medium,
    flexShrink: 1,
  },

  right: {
    flexDirection: 'row',
    alignItems:    'center',
    gap:           BAR_GAP,
  },
  circleBtn: {
    width:           CIRCLE,
    height:          CIRCLE,
    borderRadius:    CIRCLE / 2,
    backgroundColor: COLORS.circle,
    alignItems:      'center',
    justifyContent:  'center',
    position:        'relative',
  },
  badge: {
    position:          'absolute',
    top:               -2,
    right:             -2,
    minWidth:          16,
    height:            16,
    borderRadius:      8,
    backgroundColor:   COLORS.cyan,
    alignItems:        'center',
    justifyContent:    'center',
    paddingHorizontal: 3,
    borderWidth:       1.5,
    borderColor:       COLORS.bg,
  },
  badgeText: {
    color:      '#0a0a0a',
    fontSize:   9,
    fontWeight: '800',
    lineHeight: 12,
  },

  avatar: {
    width:           CIRCLE,
    height:          CIRCLE,
    borderRadius:    CIRCLE / 2,
    backgroundColor: COLORS.avatar,
    borderWidth:     1,
    borderColor:     'rgba(255,255,255,0.14)',
    alignItems:      'center',
    justifyContent:  'center',
  },
  avatarText: {
    color:      COLORS.white,
    fontSize:   15,
    fontFamily: FONTS.aboreto.regular,
  },
  avatarActive: {
    borderColor: COLORS.cyan,
    borderWidth: 1.5,
  },
})
