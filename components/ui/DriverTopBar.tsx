/**
 * The driver app's top bar, built from the Figma "Home" frame (node 2727:1297):
 * the 8338 wordmark on the left, then message, notification and profile
 * circles on the right.
 *
 * There is no sidebar behind it, so this bar carries the whole chrome: the
 * wordmark is the way home, screens below home get a back chevron, and the
 * profile circle opens the menu that used to live in the drawer (account,
 * change password, sign out).
 */
import React, { useState } from 'react'
import {
  View,
  Text,
  Image,
  Modal,
  Pressable,
  TouchableOpacity,
  StyleSheet,
} from 'react-native'
import { MotiView } from 'moti'
import { useRouter, usePathname } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Bell, MessageCircle, ChevronLeft, KeyRound, LogOut } from 'lucide-react-native'

import { useAuthStore } from '../../lib/store/auth.store'
import { useAvailabilityStore } from '../../lib/store/availability.store'
import { useMessagingStore } from '../../lib/store/messaging.store'
import { useNotificationStore } from '../../lib/store/notification.store'
import { logout } from '../../lib/api/auth.api'
import { unregisterPushNotifications } from '../../lib/push'
import { FONTS } from '../../lib/config/fonts'
import ReusableModal from './ReusableModal'

const logoImg = require('../../assets/Final_Logo.png')

const HOME_ROUTE = '/driver/home'

/**
 * Screens that trade the wordmark for their own name in the bar, per the
 * "My Assignments" frame (node 2734:1475). Anything not listed keeps the
 * wordmark and just gains a back chevron.
 */
const TITLES: Record<string, string> = {
  '/driver/driver-assignment': 'My Assignments',
  '/driver/maintenance':       'Maintenance',
}

const COLORS = {
  bg:        '#000000',
  titledBg:  '#0e1010',
  titledLine:'#424242',
  circle:    '#343434',
  avatar:    '#000000',
  white:     '#ffffff',
  cyan:      '#4df9ed',
  menuBg:    '#141414',
  menuLine:  '#2a2a2a',
  faint:     '#818181',
  danger:    '#f87171',
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
  const clearUser    = useAuthStore((s) => s.clearUser)
  const totalUnread  = useMessagingStore((s) => s.totalUnread)
  const unreadNotifs = useNotificationStore((s) => s.unreadCount)

  const [menuOpen,    setMenuOpen]    = useState(false)
  const [logoutModal, setLogoutModal] = useState(false)

  const isHome = pathname === HOME_ROUTE
  const title  = TITLES[pathname]

  const displayName =
    user?.first_name && user?.last_name
      ? `${user.first_name} ${user.last_name}`
      : user?.username ?? 'Driver'

  const roleLabel = user?.role?.replace(/_/g, ' ') ?? ''

  // "D1" in the design — a driver reads their own badge faster than one letter.
  const initials = (
    (user?.first_name?.[0] ?? '') + (user?.last_name?.[0] ?? '')
  ).toUpperCase() || user?.username?.[0]?.toUpperCase() || '?'

  const handleLogout = async () => {
    try {
      await unregisterPushNotifications()
      await logout()
    } catch {
    } finally {
      clearUser()
      // Availability is per driver — drop it so the next sign-in on this device
      // doesn't show the previous driver's switch state.
      useAvailabilityStore.getState().reset()
      router.replace('/')
    }
  }

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

        <View style={styles.right}>
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
            onPress={() => setMenuOpen(true)}
            activeOpacity={0.75}
            accessibilityRole="button"
            accessibilityLabel={`Account menu for ${displayName}`}
            style={styles.avatar}
          >
            <Text style={styles.avatarText}>{initials}</Text>
          </TouchableOpacity>
        </View>
      </MotiView>

      <Modal
        visible={menuOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setMenuOpen(false)}
      >
        <Pressable style={styles.menuBackdrop} onPress={() => setMenuOpen(false)}>
          <View
            style={[styles.menu, { top: insets.top + BAR_TOP + CIRCLE + 8 }]}
            onStartShouldSetResponder={() => true}
          >
            <View style={styles.menuHeader}>
              <View style={styles.menuAvatar}>
                <Text style={styles.menuAvatarText}>{initials}</Text>
              </View>
              <View style={styles.menuIdentity}>
                <Text style={styles.menuName} numberOfLines={1}>{displayName}</Text>
                {!!roleLabel && (
                  <Text style={styles.menuRole} numberOfLines={1}>{roleLabel}</Text>
                )}
              </View>
            </View>

            <View style={styles.menuLine} />

            <MenuRow
              icon={<KeyRound size={16} color={COLORS.white} />}
              label="Change password"
              onPress={() => {
                setMenuOpen(false)
                router.push('/change-password')
              }}
            />
            <MenuRow
              icon={<LogOut size={16} color={COLORS.danger} />}
              label="Sign out"
              danger
              onPress={() => {
                setMenuOpen(false)
                setLogoutModal(true)
              }}
            />
          </View>
        </Pressable>
      </Modal>

      <ReusableModal
        open={logoutModal}
        title="Sign Out"
        description="Are you sure you want to sign out of your account?"
        confirmLabel="Yes"
        cancelLabel="No"
        onConfirm={async () => {
          setLogoutModal(false)
          await handleLogout()
        }}
        onCancel={() => setLogoutModal(false)}
      />
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

function MenuRow({
  icon, label, onPress, danger = false,
}: {
  icon:    React.ReactNode
  label:   string
  onPress: () => void
  danger?: boolean
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.75}
      accessibilityRole="button"
      style={styles.menuRow}
    >
      <View style={styles.menuIcon}>{icon}</View>
      <Text style={[styles.menuLabel, danger && { color: COLORS.danger }]}>{label}</Text>
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

  menuBackdrop: {
    flex:            1,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  menu: {
    position:        'absolute',
    right:           24,
    width:           232,
    borderRadius:    16,
    backgroundColor: COLORS.menuBg,
    borderWidth:     1,
    borderColor:     COLORS.menuLine,
    paddingVertical: 8,
    shadowColor:     '#000',
    shadowOffset:    { width: 0, height: 8 },
    shadowOpacity:   0.5,
    shadowRadius:    16,
    elevation:       12,
  },
  menuHeader: {
    flexDirection:     'row',
    alignItems:        'center',
    gap:               10,
    paddingHorizontal: 14,
    paddingVertical:   8,
  },
  menuAvatar: {
    width:           34,
    height:          34,
    borderRadius:    17,
    backgroundColor: COLORS.cyan,
    alignItems:      'center',
    justifyContent:  'center',
  },
  menuAvatarText: {
    color:      '#0a0a0a',
    fontSize:   13,
    fontWeight: '800',
  },
  menuIdentity: {
    flex: 1,
  },
  menuName: {
    color:      COLORS.white,
    fontSize:   14,
    fontWeight: '600',
  },
  menuRole: {
    color:         COLORS.faint,
    fontSize:      12,
    marginTop:     1,
    textTransform: 'capitalize',
  },
  menuLine: {
    height:           1,
    backgroundColor:  COLORS.menuLine,
    marginHorizontal: 10,
    marginVertical:   6,
  },
  menuRow: {
    flexDirection:     'row',
    alignItems:        'center',
    gap:               12,
    paddingHorizontal: 14,
    paddingVertical:   11,
  },
  menuIcon: {
    width:          20,
    alignItems:     'center',
    justifyContent: 'center',
  },
  menuLabel: {
    color:      COLORS.white,
    fontSize:   14,
    fontWeight: '500',
  },
})
