import React, { useState } from 'react'
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Pressable,
} from 'react-native'
import { MotiView, AnimatePresence } from 'moti'
import { useRouter, usePathname } from 'expo-router'
import { Settings, LogOut } from 'lucide-react-native'
import { useAuthStore } from '../../../lib/store/auth.store'
import ReusableModal from './ReusableModal'
import { Easing } from 'react-native-reanimated'


const COLORS = {
  bg:         '#1a1a1a',
  surface:    '#242424',
  cyan:       '#00e5ff',
  white:      '#ffffff',
  whiteFaint: 'rgba(255,255,255,0.06)',
  whiteDim:   'rgba(255,255,255,0.40)',
  border:     'rgba(255,255,255,0.07)',
  overlay:    'rgba(0,0,0,0.60)',
  cyanBorder: 'rgba(0,229,255,0.20)',
  cyanGlow:   'rgba(0,229,255,0.25)',
  redHover:   '#f87171',
}

const SIDEBAR_WIDTH = 260

export interface NavItem {
  href:  string
  label: string
  icon:  React.ReactNode
}

interface ReusableSidebarProps {
  navItems:       NavItem[]
  sidebarOpen:    boolean
  setSidebarOpen: (open: boolean) => void
  onLogout:       () => Promise<void>
}

export default function ReusableSidebar({
  navItems,
  sidebarOpen,
  setSidebarOpen,
  onLogout,
}: ReusableSidebarProps) {
  const pathname = usePathname()
  const router   = useRouter()
  const user     = useAuthStore((s) => s.user)
  const [logoutModal, setLogoutModal] = useState(false)

  const close = () => setSidebarOpen(false)

  const displayName =
    user?.first_name && user?.last_name
      ? `${user.first_name} ${user.last_name}`
      : user?.username ?? 'User'

  const avatarLetter =
    user?.first_name?.[0]?.toUpperCase() ??
    user?.username?.[0]?.toUpperCase()   ??
    '?'

  const roleLabel = user?.role?.replace(/_/g, ' ') ?? ''

  return (
    <>
      <AnimatePresence>
        {sidebarOpen && (
          <>
            <MotiView
              key="backdrop"
              from={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ type: 'timing', duration: 220 }}
              style={[StyleSheet.absoluteFillObject, { backgroundColor: COLORS.overlay, zIndex: 40 }]}
            >
              <Pressable style={StyleSheet.absoluteFill} onPress={close} />
            </MotiView>

            {/* ── Drawer ── */}
            <MotiView
              key="drawer"
              from={{ translateX: -SIDEBAR_WIDTH }}
              animate={{ translateX: 0 }}
              exit={{ translateX: -SIDEBAR_WIDTH }}
              transition={{ type: 'timing', duration: 280, easing: Easing.out(Easing.cubic) }}
              style={[
                StyleSheet.absoluteFillObject,
                {
                  right:            undefined,
                  width:            SIDEBAR_WIDTH,
                  backgroundColor:  COLORS.bg,
                  borderRightWidth: 1,
                  borderRightColor: COLORS.border,
                  zIndex:           41,
                  paddingTop:       56,
                  paddingBottom:    32,
                  flexDirection:    'column',
                },
              ]}
            >
              <MotiView
                from={{ opacity: 0, translateX: -12 }}
                animate={{ opacity: 1, translateX: 0 }}
                transition={{ type: 'timing', duration: 280, delay: 80 }}
                style={styles.userRow}
              >
                <View style={styles.userAvatar}>
                  <Text style={styles.userAvatarText}>{avatarLetter}</Text>
                </View>
                <View style={styles.userInfo}>
                  <Text style={styles.userName} numberOfLines={1}>
                    {displayName}
                  </Text>
                  <Text style={styles.userRole} numberOfLines={1}>
                    {roleLabel}
                  </Text>
                </View>
              </MotiView>

              <View style={styles.sep} />

              <View style={styles.nav}>
                {navItems.map((item, i) => (
                  <NavItemRow
                    key={item.href}
                    item={item}
                    index={i}
                    isActive={
                      item.href.endsWith('/')
                        ? pathname === item.href
                        : pathname === item.href || pathname.startsWith(item.href + '/')
                    }
                    onPress={() => {
                      close()
                      router.push(item.href as any)
                    }}
                  />
                ))}
              </View>

              <View style={styles.bottomSep} />

              <View style={styles.bottom}>
                <NavItemRow
                  item={{
                    href:  '/settings',
                    label: 'Settings',
                    icon:  <Settings size={17} color={COLORS.whiteDim} />,
                  }}
                  index={0}
                  isActive={pathname === '/settings'}
                  onPress={() => { close(); router.push('/settings') }}
                />
                <TouchableOpacity
                  activeOpacity={0.75}
                  onPress={() => setLogoutModal(true)}
                  style={styles.logoutBtn}
                >
                  <View style={styles.iconSlot}>
                    <LogOut size={17} color={COLORS.redHover} />
                  </View>
                  <Text style={styles.logoutText}>Sign out</Text>
                </TouchableOpacity>
              </View>
            </MotiView>
          </>
        )}
      </AnimatePresence>

      <ReusableModal
        open={logoutModal}
        title="Sign Out"
        description="Are you sure you want to sign out of your account?"
        confirmLabel="Yes"
        cancelLabel="No"
        onConfirm={async () => {
          setLogoutModal(false)
          close()
          await onLogout()
        }}
        onCancel={() => setLogoutModal(false)}
      />
    </>
  )
}

interface NavItemRowProps {
  item:     NavItem
  index:    number
  isActive: boolean
  onPress:  () => void
}

function NavItemRow({ item, index, isActive, onPress }: NavItemRowProps) {
  return (
    <MotiView
      from={{ opacity: 0, translateX: -18 }}
      animate={{ opacity: 1, translateX: 0 }}
      transition={{ type: 'timing', duration: 280, delay: 60 + index * 55 }}
    >
      <TouchableOpacity
        activeOpacity={0.75}
        onPress={onPress}
        style={styles.navItem}
      >
        <AnimatePresence>
          {isActive && (
            <MotiView
              key="active-bg"
              from={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ type: 'spring', stiffness: 320, damping: 32 }}
              style={styles.activeBg}
            />
          )}
        </AnimatePresence>

        <View style={styles.iconSlot}>{item.icon}</View>
        <Text
          style={[styles.navLabel, isActive && styles.navLabelActive]}
          numberOfLines={1}
        >
          {item.label}
        </Text>
      </TouchableOpacity>
    </MotiView>
  )
}

const styles = StyleSheet.create({
  userRow: {
    flexDirection:     'row',
    alignItems:        'center',
    gap:               12,
    paddingHorizontal: 16,
    marginBottom:      20,
  },
  userAvatar: {
    width:           32,
    height:          32,
    borderRadius:    16,
    backgroundColor: COLORS.cyan,
    alignItems:      'center',
    justifyContent:  'center',
    shadowColor:     COLORS.cyan,
    shadowOffset:    { width: 0, height: 0 },
    shadowOpacity:   0.5,
    shadowRadius:    6,
    elevation:       4,
  },
  userAvatarText: {
    color:      COLORS.bg,
    fontSize:   13,
    fontWeight: '700',
  },
  userInfo: {
    flex: 1,
  },
  userName: {
    color:      COLORS.white,
    fontSize:   14,
    fontWeight: '600',
  },
  userRole: {
    color:         COLORS.whiteDim,
    fontSize:      12,
    marginTop:     1,
    textTransform: 'capitalize',
  },

  sep: {
    height:           1,
    backgroundColor:  COLORS.border,
    marginHorizontal: 16,
    marginBottom:     12,
  },

  nav: {
    flex:              1,
    paddingHorizontal: 8,
    gap:               2,
  },

  navItem: {
    flexDirection:     'row',
    alignItems:        'center',
    gap:               12,
    paddingVertical:   12,
    paddingHorizontal: 8,
    borderRadius:      12,
    overflow:          'hidden',
    position:          'relative',
  },
  activeBg: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: COLORS.whiteFaint,
    borderRadius:    12,
    borderWidth:     1,
    borderColor:     COLORS.cyanBorder,
  },
  iconSlot: {
    width:          24,
    alignItems:     'center',
    justifyContent: 'center',
  },
  navLabel: {
    color:      COLORS.whiteDim,
    fontSize:   15,
    fontWeight: '500',
    flex:       1,
  },
  navLabelActive: {
    color:      COLORS.cyan,
    fontWeight: '600',
  },

  bottomSep: {
    height:           1,
    backgroundColor:  COLORS.border,
    marginHorizontal: 8,
    marginVertical:   8,
  },
  bottom: {
    paddingHorizontal: 8,
    gap:               2,
  },

  logoutBtn: {
    flexDirection:     'row',
    alignItems:        'center',
    gap:               12,
    paddingVertical:   12,
    paddingHorizontal: 8,
    borderRadius:      12,
  },
  logoutText: {
    color:      COLORS.redHover,
    fontSize:   15,
    fontWeight: '500',
  },
})