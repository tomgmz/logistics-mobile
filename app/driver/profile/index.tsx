import React, { useCallback, useEffect, useState } from 'react'
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'
import { useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { RotateCw } from 'lucide-react-native'
import { useNetInfo } from '@react-native-community/netinfo'

import { getProfile, requestPasswordReset, type Profile } from '../../../lib/api/auth.api'
import { useAuthStore, useDriverId } from '../../../lib/store/auth.store'
import { useLiveSignal } from '../../../hooks/useLiveSignal'
import { signOutDriver } from '../../../lib/signOut'
import { roleLabel } from '../../../lib/roles'
import { FONTS } from '../../../lib/config/fonts'
import { ConfirmDialog } from '../../../components/ui/ConfirmDialog'
import ReusableModal from '../../../components/ui/ReusableModal'
import PushNotificationsRow from '../../../components/profile/PushNotificationsRow'
import {
  AvatarRing, BackCircleIcon, FadedDashedLine, GuideBookIcon, KeyIcon, PasskeyShieldIcon, SignOutIcon,
} from '../../../components/profile/ProfileIcons'

/**
 * The driver's Profile screen (2026-11-28), opened from the profile circle in
 * the top bar. It replaces the small account menu that used to drop down from
 * that circle, and is laid out like the web Profile page (ProfileView.tsx):
 * the avatar card, Personal Information, Account, Security, Notification,
 * User Guide, then Sign Out. Since 2026-11-29 it follows the Figma in
 * Figma (8338 LOGISTICS SERVICES, frames 2530:1771 + 2530:1974; PNGs in
 * docs/figma/driver_profile), icons included (components/profile/ProfileIcons): its own header (back, PROFILE, ONLINE pill, like
 * Messages) instead of the shared top bar, cyan section titles, two-column
 * fields and cyan outline buttons.
 *
 * Everything the old menu had is here: Phone notifications, Passkey Setup and
 * Sign out. Like the web, the details are read-only (the office changes them)
 * and the password is never changed with the session alone: "Request Change
 * Password" asks the IT Administrator, who emails a one-time link.
 *
 * The User Guide opens on its own screen inside the app (app/driver/user-guide,
 * 2026-11-28), not in the browser like the web.
 */

const C = {
  bg:      '#000000',
  card:    '#0e1010',
  line:    '#424242',
  white:   '#ffffff',
  soft:    'rgba(255,255,255,0.85)',
  faint:   '#818181',
  cyan:    '#4df9ed',
  cyanBg:  'rgba(77,249,237,0.07)',
  cyanLn:  'rgba(77,249,237,0.40)',
  green:   '#3af626',
  red:     '#f62626',
  redBg:   '#220606',
}

/** How far the avatar circle rises above the top edge of its card (Figma). */
const AVATAR = 99
const AVATAR_RISE = 30.5

/** "28 Nov 2026, 3:05 PM" in Philippine time, built by hand so it reads the same whatever Intl data the phone ships. */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
function formatWhen(iso: string | null | undefined): string {
  if (!iso) return 'Never'
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return '—'
  const d = new Date(t + 8 * 60 * 60 * 1000) // Asia/Manila is UTC+8 all year (no daylight saving).
  const h = d.getUTCHours()
  const m = String(d.getUTCMinutes()).padStart(2, '0')
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}, ${h % 12 || 12}:${m} ${h < 12 ? 'AM' : 'PM'}`
}

function fullName(p: Profile): string {
  const name = [p.first_name, p.middle_name, p.last_name, p.suffix]
    .map((s) => s?.trim())
    .filter(Boolean)
    .join(' ')
  return name || p.email
}

function errorText(err: any, fallback: string): string {
  if (!err?.response) return 'Could not reach the server. Check your connection and try again.'
  return err.response?.data?.message ?? fallback
}

export default function DriverProfileScreen() {
  const insets   = useSafeAreaInsets()
  const router   = useRouter()
  const userId   = useAuthStore((s) => s.user?.user_id ?? '')
  const driverId = useDriverId()

  // The ONLINE pill, as on Messages: whether this phone has a connection.
  const netInfo  = useNetInfo()
  const online   = netInfo.isConnected !== false

  const [profile,    setProfile]    = useState<Profile | null>(null)
  const [loadError,  setLoadError]  = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [signingOut, setSigningOut] = useState(false)
  const [askSignOut, setAskSignOut] = useState(false)

  const load = useCallback(async () => {
    try {
      setProfile(await getProfile())
      setLoadError(null)
    } catch (err: any) {
      setLoadError(errorText(err, 'Your profile could not be loaded.'))
    }
  }, [])

  useEffect(() => { void load() }, [load])

  // Live: the office changing this driver's name, email or number shows at once.
  // live:users fires for every account, so only a burst that names this driver
  // (users row = user_id, drivers row = driver_id) re-reads; an empty set means
  // the app came back to the foreground or the connection returned.
  useLiveSignal('live:users', (ids) => {
    if (ids.size === 0 || ids.has(userId) || (!!driverId && ids.has(driverId))) void load()
  })

  const onRefresh = useCallback(async () => {
    setRefreshing(true)
    await load()
    setRefreshing(false)
  }, [load])

  const signOut = async () => {
    setSigningOut(true)
    // Stops tracking, ends the nav session and clears the driver's local state too — see lib/signOut.
    await signOutDriver()
    router.replace('/')
  }

  const goBack = () => (router.canGoBack() ? router.back() : router.replace('/driver/home'))

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      {/* Header: back circle, PROFILE, connection pill (same as Messages). */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={goBack}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel="Back"
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <BackCircleIcon />
        </TouchableOpacity>
        <Text style={styles.title} numberOfLines={1}>PROFILE</Text>
        <View style={[styles.statusPill, !online && styles.statusPillOff]}>
          <View style={[styles.statusDot, !online && styles.statusDotOff]} />
          <Text style={[styles.statusText, !online && styles.statusTextOff]}>{online ? 'ONLINE' : 'OFFLINE'}</Text>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: Math.max(insets.bottom, 16) + 24 }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.cyan} />}
      >
        {loadError && !profile ? (
          <View style={[styles.card, styles.center]}>
            <Text style={styles.errorText}>{loadError}</Text>
            <OutlineButton
              icon={<RotateCw size={16} color={C.cyan} />}
              label="Retry"
              onPress={() => { setLoadError(null); void load() }}
            />
          </View>
        ) : !profile ? (
          <View style={[styles.card, styles.center, { paddingVertical: 40 }]}>
            <ActivityIndicator color={C.cyan} />
          </View>
        ) : (
          <>
            <MetaCard profile={profile} />
            <PersonalCard profile={profile} />
            <AccountCard profile={profile} />
            <SecurityCard email={profile.email} onPasskeys={() => router.push('/driver/passkeys')} />
            <Card title="Notification">
              <PushNotificationsRow />
            </Card>
            <Card title="User Guide">
              <ActionRow
                title={`${roleLabel(profile.role)} Guide`}
                hint="How each screen you use works, step by step. Opens here in the app and stays on this phone, so it also opens without signal."
                action={
                  <OutlineButton
                    icon={<GuideBookIcon />}
                    label="Open User Guide"
                    onPress={() => router.push('/driver/user-guide')}
                  />
                }
              />
            </Card>
          </>
        )}

        {/* Always reachable, even when the profile could not load. */}
        <TouchableOpacity
          onPress={() => setAskSignOut(true)}
          disabled={signingOut}
          activeOpacity={0.75}
          accessibilityRole="button"
          style={[styles.signOut, signingOut && { opacity: 0.6 }]}
        >
          {signingOut
            ? <ActivityIndicator size="small" color={C.red} />
            : <SignOutIcon />}
          <Text style={styles.signOutText}>Sign Out</Text>
        </TouchableOpacity>
      </ScrollView>

      <ReusableModal
        open={askSignOut}
        title="Sign Out"
        description="Are you sure you want to sign out of your account?"
        confirmLabel="Yes"
        cancelLabel="No"
        onConfirm={() => { setAskSignOut(false); void signOut() }}
        onCancel={() => setAskSignOut(false)}
      />
    </View>
  )
}

// ── Pieces (Figma docs/figma/driver_profile, 2026-11-29) ─────────────────────

function Card({ title, note, children }: { title?: string; note?: string; children: React.ReactNode }) {
  return (
    <View style={styles.card}>
      {title && (
        <View style={styles.cardHeader}>
          <Text style={styles.cardTitle}>{title.toUpperCase()}</Text>
          {!!note && <Text style={styles.cardNote}>{note}</Text>}
        </View>
      )}
      {children}
    </View>
  )
}

/** Two fields per row, as in the Figma grid. */
function Fields({ items }: { items: { label: string; value: string }[] }) {
  return (
    <View style={styles.fields}>
      {items.map((f) => (
        <View key={f.label} style={styles.field}>
          <Text style={styles.fieldLabel}>{f.label}</Text>
          <Text style={styles.fieldValue} selectable>{f.value}</Text>
        </View>
      ))}
    </View>
  )
}

function ActionRow({ title, hint, action }: { title: string; hint: React.ReactNode; action?: React.ReactNode }) {
  return (
    <View style={styles.actionRow}>
      <Text style={styles.actionTitle}>{title.toUpperCase()}</Text>
      <Text style={styles.actionHint}>{hint}</Text>
      {action}
    </View>
  )
}

/** The Figma's cyan outline button (icon + label). */
function OutlineButton({ icon, label, onPress }: { icon: React.ReactNode; label: string; onPress: () => void }) {
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.75} accessibilityRole="button" hitSlop={{ top: 7, bottom: 7 }} style={styles.button}>
      {icon}
      <Text style={styles.buttonText}>{label}</Text>
    </TouchableOpacity>
  )
}

/** Avatar (rising above the card's top edge), name and role. */
function MetaCard({ profile }: { profile: Profile }) {
  const initials = (
    (profile.first_name?.[0] ?? '') + (profile.last_name?.[0] ?? '')
  ).toUpperCase() || profile.email[0]?.toUpperCase() || '?'
  return (
    <View style={styles.metaWrap}>
      <View style={styles.meta}>
        <Text style={styles.metaName}>{fullName(profile)}</Text>
        <Text style={styles.metaRole}>{roleLabel(profile.role).toUpperCase()}</Text>
      </View>
      <View style={styles.avatar}>
        <View style={StyleSheet.absoluteFill}><AvatarRing size={AVATAR} /></View>
        <Text style={styles.avatarText}>{initials}</Text>
      </View>
    </View>
  )
}

function PersonalCard({ profile }: { profile: Profile }) {
  const suffix = profile.suffix?.trim()
  const items = [
    { label: 'First Name',  value: profile.first_name?.trim() || 'Not set' },
    { label: 'Middle Name', value: profile.middle_name?.trim() || 'None' },
    { label: 'Last Name',   value: profile.last_name?.trim() || 'Not set' },
    { label: 'Email',       value: profile.email },
    { label: 'Mobile Number', value: profile.phone?.trim() || 'Not set' },
  ]
  if (suffix) items.splice(3, 0, { label: 'Suffix', value: suffix })
  return (
    // Drivers are edited in Driver Management by the Company Administrator.
    <Card title="Personal Information" note="Ask the Company Administrator to change these.">
      <Fields items={items} />
    </Card>
  )
}

function AccountCard({ profile }: { profile: Profile }) {
  return (
    <Card title="Account">
      <Fields
        items={[
          { label: 'Role',            value: roleLabel(profile.role) },
          { label: 'Account Created', value: formatWhen(profile.created_at) },
          { label: 'Last Sign-in',    value: formatWhen(profile.last_login_at) },
        ]}
      />
    </Card>
  )
}

/**
 * Password + passkey. A driver is not a self-service role (SELF_RESET_ROLES in
 * the backend), so the password button sends a request the IT Administrator
 * answers with an emailed one-time link — the same POST /auth/forgot-password
 * the sign-in screen and the web Profile use.
 */
function SecurityCard({ email, onPasskeys }: { email: string; onPasskeys: () => void }) {
  const [confirming, setConfirming] = useState(false)
  const [sending,    setSending]    = useState(false)
  const [sent,       setSent]       = useState(false)
  const [error,      setError]      = useState('')

  const send = async () => {
    if (sending) return
    setSending(true); setError('')
    try {
      await requestPasswordReset(email)
      setSent(true)
    } catch (err: any) {
      setError(errorText(err, 'Could not send your request. Please try again.'))
    } finally {
      setSending(false)
      setConfirming(false)
    }
  }

  return (
    <Card title="Security">
      <ActionRow
        title="Password"
        hint={
          <>
            Password changes go through the IT Administrator. Send a request and they will email a one-time
            link to <Text style={styles.email}>{email}</Text>. The link works once and expires 5 minutes after
            it is sent.
          </>
        }
        action={sent ? null : (
          <OutlineButton
            icon={<KeyIcon />}
            label="Request Change Password"
            onPress={() => setConfirming(true)}
          />
        )}
      />
      {sent && (
        <View style={styles.sentBox}>
          <Text style={styles.sentText}>
            Request sent. The IT Administrator has been notified and will email you a link. Asking again only
            reminds them; there is still one request.
          </Text>
        </View>
      )}
      {!!error && <Text style={styles.inlineError}>{error}</Text>}

      <View style={styles.divider}><FadedDashedLine /></View>

      <ActionRow
        title="Passkey"
        hint="Sign in with your phone's fingerprint, face or screen lock instead of a code or password."
        action={
          <OutlineButton
            icon={<PasskeyShieldIcon />}
            label="Passkey Setup"
            onPress={onPasskeys}
          />
        }
      />

      <ConfirmDialog
        visible={confirming}
        title="Request a password change?"
        message={`The IT Administrator gets your request and emails a one-time link to ${email}. After you set the new password, you sign in again on every device.`}
        confirmLabel="Send Request"
        cancelLabel="Cancel"
        busy={sending}
        onConfirm={() => { void send() }}
        onCancel={() => { if (!sending) setConfirming(false) }}
      />
    </Card>
  )
}

const DG = FONTS.darker

// Sizes are the Figma's (360 px wide frame, 19 px side margin, 321 px cards).
const styles = StyleSheet.create({
  root:    { flex: 1, backgroundColor: C.bg },
  content: { paddingHorizontal: 19, paddingTop: 0, gap: 10 },

  // Header: back circle, PROFILE, connection pill.
  header: {
    flexDirection: 'row', alignItems: 'center', gap: 11,
    paddingHorizontal: 19, paddingTop: 14, paddingBottom: 6,
  },
  title: { flex: 1, color: C.white, fontSize: 36, fontFamily: DG.bold, lineHeight: 40 },
  statusPill: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 6, height: 18, minWidth: 59, borderRadius: 16,
    backgroundColor: 'rgba(58,246,38,0.19)', borderWidth: 0.4, borderColor: C.green,
  },
  statusPillOff: { backgroundColor: 'rgba(255,255,255,0.06)', borderColor: C.faint },
  statusDot:     { width: 6, height: 6, borderRadius: 3, backgroundColor: C.green },
  statusDotOff:  { backgroundColor: C.faint },
  statusText:    { color: C.green, fontSize: 12, fontFamily: DG.medium, lineHeight: 14 },
  statusTextOff: { color: C.faint },

  card:       {
    borderRadius: 15, borderWidth: 0.5, borderColor: C.line, backgroundColor: C.card,
    paddingHorizontal: 15.5, paddingTop: 8, paddingBottom: 16,
  },
  center:     { alignItems: 'center', gap: 12, paddingTop: 16 },
  cardHeader: { marginBottom: 12 },
  cardTitle:  { color: C.cyan, fontSize: 14, lineHeight: 18, fontFamily: DG.bold },
  cardNote:   { color: C.faint, fontSize: 10, lineHeight: 12, fontFamily: DG.medium },

  // Avatar card: cyan edge, the 99 px circle rises 30.5 px above it.
  metaWrap:   { marginTop: AVATAR_RISE + 11, alignItems: 'center' },
  meta:       {
    alignSelf: 'stretch', alignItems: 'center', minHeight: 133,
    paddingTop: AVATAR - AVATAR_RISE + 5, paddingBottom: 12, paddingHorizontal: 16,
    borderRadius: 15, borderWidth: 0.5, borderColor: C.cyan, backgroundColor: C.card,
  },
  avatar:     {
    position: 'absolute', top: -AVATAR_RISE,
    width: AVATAR, height: AVATAR, alignItems: 'center', justifyContent: 'center',
  },
  avatarText: { color: C.white, fontSize: 24, fontFamily: FONTS.aboreto.regular },
  metaName:   { color: C.white, fontSize: 25, lineHeight: 28, textAlign: 'center', fontFamily: DG.bold },
  metaRole:   { color: C.white, fontSize: 14, lineHeight: 18, marginTop: 4, textAlign: 'center', fontFamily: DG.medium },

  // Two columns: label, 19 px down the value, 25 px to the next label.
  fields:     { flexDirection: 'row', flexWrap: 'wrap', rowGap: 10 },
  field:      { width: '50%', paddingRight: 8, minWidth: 0 },
  fieldLabel: { color: C.faint, fontSize: 12, lineHeight: 15, marginBottom: 4, fontFamily: DG.bold },
  fieldValue: { color: C.white, fontSize: 12, lineHeight: 15, fontFamily: DG.bold },

  actionRow:   { gap: 4 },
  actionTitle: { color: C.white, fontSize: 12, lineHeight: 15, fontFamily: DG.bold },
  actionHint:  { color: C.faint, fontSize: 12, lineHeight: 13, textAlign: 'justify', fontFamily: DG.bold },
  email:       { color: C.white, fontFamily: DG.bold },
  divider:     { marginTop: 20, marginBottom: 10 },

  // Cyan outline button: 31 px, 0.5 px cyan edge, 12 px icon, 4 px gap.
  button:     {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4,
    height: 31, borderRadius: 10, borderWidth: 0.5, borderColor: C.cyan, paddingHorizontal: 24,
    alignSelf: 'stretch', marginTop: 2,
  },
  buttonText: { color: C.cyan, fontSize: 16, lineHeight: 19, fontFamily: DG.medium },

  sentBox:     {
    marginTop: 12, borderRadius: 8, borderWidth: 0.5, borderColor: C.cyanLn, backgroundColor: C.cyanBg,
    paddingHorizontal: 14, paddingVertical: 12,
  },
  sentText:    { color: C.soft, fontSize: 13, lineHeight: 15, fontFamily: DG.bold },
  inlineError: { color: C.red, fontSize: 13, marginTop: 10, fontFamily: DG.bold },
  errorText:   { color: C.soft, fontSize: 15, textAlign: 'center', fontFamily: DG.bold },

  signOut:     {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4,
    height: 34, borderRadius: 8, borderWidth: 1, borderColor: C.red, backgroundColor: C.redBg, marginTop: 10,
  },
  signOutText: { color: C.red, fontSize: 15, lineHeight: 18, fontFamily: DG.bold },
})
