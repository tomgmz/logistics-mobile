import React from 'react'
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Platform,
} from 'react-native'
import { MotiView } from 'moti'
import { Bell, MessageCircle, Menu } from 'lucide-react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useAuthStore } from '../../../lib/store/auth.store'

const COLORS = {
  bg:      '#1a1a1a',
  cyan:    '#00e5ff',
  white:   '#ffffff',
  border:  'rgba(255,255,255,0.07)',
  glass:   'rgba(255,255,255,0.06)',
}

const HEADER_HEIGHT = 64

interface ReusableHeaderProps {
  sidebarOpen:     boolean
  onToggleSidebar: () => void
}

export default function ReusableHeader({
  onToggleSidebar,
}: ReusableHeaderProps) {
  const insets = useSafeAreaInsets()
  const user   = useAuthStore((s) => s.user)

  const avatarLetter =
    user?.first_name?.[0]?.toUpperCase() ??
    user?.username?.[0]?.toUpperCase()   ??
    '?'

  return (
    <MotiView
      from={{ translateY: -80, opacity: 0 }}
      animate={{ translateY: 0, opacity: 1 }}
      transition={{ type: 'timing', duration: 500 }}
      style={[
        styles.header,
        { paddingTop: insets.top, height: HEADER_HEIGHT + insets.top },
      ]}
    >
      <View style={styles.left}>
        <TouchableOpacity
          onPress={onToggleSidebar}
          activeOpacity={0.7}
          style={styles.menuBtn}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Menu size={20} color={COLORS.white} />
        </TouchableOpacity>

        <LogoMark />
      </View>

      <View style={styles.right}>
        <IconBtn>
          <MessageCircle size={16} color={COLORS.white} />
        </IconBtn>

        <IconBtn badge>
          <Bell size={16} color={COLORS.white} />
        </IconBtn>

        <MotiView
          from={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 260, damping: 20, delay: 300 }}
          style={styles.avatar}
        >
          <Text style={styles.avatarText}>{avatarLetter}</Text>
        </MotiView>
      </View>
    </MotiView>
  )
}

function IconBtn({
  children,
  badge = false,
}: {
  children: React.ReactNode
  badge?: boolean
}) {
  return (
    <TouchableOpacity activeOpacity={0.7} style={styles.iconBtn}>
      {children}
      {badge && <View style={styles.badge} />}
    </TouchableOpacity>
  )
}

function LogoMark() {
  return (
    <View style={styles.logoWrap}>
      <Text style={styles.logoText}>8338 LOGISTICS</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  header: {
    flexDirection:     'row',
    alignItems:        'flex-end',
    justifyContent:    'space-between',
    paddingHorizontal: 16,
    paddingBottom:     12,
    backgroundColor:   COLORS.bg,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    zIndex:            50,
    ...Platform.select({
      ios: {
        shadowColor:   '#000',
        shadowOffset:  { width: 0, height: 2 },
        shadowOpacity: 0.3,
        shadowRadius:  4,
      },
      android: {
        elevation: 8,
      },
    }),
  },

  left: {
    flexDirection: 'row',
    alignItems:    'center',
    gap:           12,
  },
  menuBtn: {
    padding:      8,
    borderRadius: 8,
  },

  logoWrap: {
    justifyContent: 'center',
  },
  logoText: {
    color:         COLORS.cyan,
    fontSize:      13,
    fontWeight:    '700',
    letterSpacing: 2,
  },

  right: {
    flexDirection: 'row',
    alignItems:    'center',
    gap:           8,
  },
  iconBtn: {
    width:           36,
    height:          36,
    borderRadius:    18,
    backgroundColor: COLORS.glass,
    alignItems:      'center',
    justifyContent:  'center',
  },
  badge: {
    position:        'absolute',
    top:             8,
    right:           8,
    width:           6,
    height:          6,
    borderRadius:    3,
    backgroundColor: COLORS.cyan,
  },

  avatar: {
    width:           36,
    height:          36,
    borderRadius:    18,
    backgroundColor: COLORS.cyan,
    alignItems:      'center',
    justifyContent:  'center',
    shadowColor:     COLORS.cyan,
    shadowOffset:    { width: 0, height: 0 },
    shadowOpacity:   0.6,
    shadowRadius:    8,
    elevation:       6,
  },
  avatarText: {
    color:      '#1a1a1a',
    fontSize:   14,
    fontWeight: '700',
  },
})

export { HEADER_HEIGHT }