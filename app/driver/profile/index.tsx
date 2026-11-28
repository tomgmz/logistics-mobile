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
import { BookOpen, ChevronRight, KeyRound, LogOut, RotateCw, ShieldCheck } from 'lucide-react-native'

import { getProfile, requestPasswordReset, type Profile } from '../../../lib/api/auth.api'
import { useAuthStore, useDriverId } from '../../../lib/store/auth.store'
import { useLiveSignal } from '../../../hooks/useLiveSignal'
import { signOutDriver } from '../../../lib/signOut'
import { roleLabel } from '../../../lib/roles'
import { FONTS } from '../../../lib/config/fonts'
import { ConfirmDialog } from '../../../components/ui/ConfirmDialog'
import ReusableModal from '../../../components/ui/ReusableModal'
import PushNotificationsRow from '../../../components/profile/PushNotificationsRow'

/**
 * The driver's Profile screen (2026-11-28), opened from the profile circle in
 * the top bar. It replaces the small account menu that used to drop down from
 * that circle, and is laid out like the web Profile page (ProfileView.tsx):
 * one outer card holding bordered cards — the avatar card, Personal
 * Information, Account, Security, Notifications, User Guide — then Sign out.
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
  bg:     '#000000',
  outer:  '#1b1b1b',
  line:   '#424242',
  white:  '#ffffff',
  soft:   'rgba(255,255,255,0.85)',
  faint:  '#818181',
  cyan:   '#4df9ed',
  cyanBg: 'rgba(77,249,237,0.07)',
  cyanLn: 'rgba(77,249,237,0.40)',
  red:    '#f62626',
  redBg:  'rgba(246,38,38,0.08)',
  redLn:  'rgba(246,38,38,0.45)',
}

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

  return (
    <View style={styles.root}>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: Math.max(insets.bottom, 16) + 24 }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.cyan} />}
      >
        <View style={styles.outer}>
          {loadError && !profile ? (
            <View style={[styles.card, styles.center]}>
              <Text style={styles.errorText}>{loadError}</Text>
              <TouchableOpacity
                onPress={() => { setLoadError(null); void load() }}
                activeOpacity={0.75}
                accessibilityRole="button"
                style={styles.button}
              >
                <RotateCw size={15} color={C.white} />
                <Text style={styles.buttonText}>Retry</Text>
              </TouchableOpacity>
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
              <Card title="Notifications">
                <PushNotificationsRow />
              </Card>
              <Card title="User Guide">
                <ActionRow
                  title={`${roleLabel(profile.role)} guide`}
                  hint="How each screen you use works, step by step. Opens here in the app and stays on this phone, so it also opens without signal."
                  action={
                    <TouchableOpacity
                      onPress={() => router.push('/driver/user-guide')}
                      activeOpacity={0.75}
                      accessibilityRole="button"
                      style={styles.button}
                    >
                      <BookOpen size={16} color={C.cyan} />
                      <Text style={styles.buttonText}>Open User Guide</Text>
                      <ChevronRight size={16} color={C.faint} />
                    </TouchableOpacity>
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
              : <LogOut size={17} color={C.red} />}
            <Text style={styles.signOutText}>Sign out</Text>
          </TouchableOpacity>
        </View>
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

// ── Pieces, mirroring the web's profile-ui.tsx ──────────────────────────────

function Card({ title, aside, children }: { title?: string; aside?: React.ReactNode; children: React.ReactNode }) {
  return (
    <View style={styles.card}>
      {title && (
        <View style={styles.cardHeader}>
          <Text style={styles.cardTitle}>{title}</Text>
          {aside}
        </View>
      )}
      {children}
    </View>
  )
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <Text style={styles.fieldValue} selectable>{value}</Text>
    </View>
  )
}

function ActionRow({ title, hint, action }: { title: string; hint: React.ReactNode; action?: React.ReactNode }) {
  return (
    <View style={styles.actionRow}>
      <Text style={styles.actionTitle}>{title}</Text>
      <Text style={styles.actionHint}>{hint}</Text>
      {action}
    </View>
  )
}

/** Avatar, name and role, as the web's user meta card. */
function MetaCard({ profile }: { profile: Profile }) {
  const initials = (
    (profile.first_name?.[0] ?? '') + (profile.last_name?.[0] ?? '')
  ).toUpperCase() || profile.email[0]?.toUpperCase() || '?'
  return (
    <View style={[styles.card, styles.meta]}>
      <View style={styles.avatar}>
        <Text style={styles.avatarText}>{initials}</Text>
      </View>
      <Text style={styles.metaName}>{fullName(profile)}</Text>
      <Text style={styles.metaRole}>{roleLabel(profile.role)}</Text>
    </View>
  )
}

function PersonalCard({ profile }: { profile: Profile }) {
  const middle = profile.middle_name?.trim()
  const suffix = profile.suffix?.trim()
  return (
    <Card
      title="Personal Information"
      // Drivers are edited in Driver Management by the Company Administrator.
      aside={<Text style={styles.asideNote}>Ask the Company Administrator to change these.</Text>}
    >
      <View style={styles.fields}>
        <Field label="First name" value={profile.first_name?.trim() || 'Not set'} />
        <Field label="Last name" value={profile.last_name?.trim() || 'Not set'} />
        {!!middle && <Field label="Middle name" value={middle} />}
        {!!suffix && <Field label="Suffix" value={suffix} />}
        <Field label="Email" value={profile.email} />
        <Field label="Mobile number" value={profile.phone?.trim() || 'Not set'} />
      </View>
    </Card>
  )
}

function AccountCard({ profile }: { profile: Profile }) {
  return (
    <Card title="Account">
      <View style={styles.fields}>
        <Field label="Role" value={roleLabel(profile.role)} />
        <Field label="Account created" value={formatWhen(profile.created_at)} />
        <Field label="Last sign-in" value={formatWhen(profile.last_login_at)} />
      </View>
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
          <TouchableOpacity
            onPress={() => setConfirming(true)}
            activeOpacity={0.75}
            accessibilityRole="button"
            style={styles.button}
          >
            <KeyRound size={16} color={C.white} />
            <Text style={styles.buttonText}>Request Change Password</Text>
          </TouchableOpacity>
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

      <View style={styles.divider} />

      <ActionRow
        title="Passkey"
        hint="Sign in with your phone's fingerprint, face or screen lock instead of a code or password."
        action={
          <TouchableOpacity
            onPress={onPasskeys}
            activeOpacity={0.75}
            accessibilityRole="button"
            style={styles.button}
          >
            <ShieldCheck size={16} color={C.cyan} />
            <Text style={styles.buttonText}>Passkey Setup</Text>
            <ChevronRight size={16} color={C.faint} />
          </TouchableOpacity>
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

const styles = StyleSheet.create({
  root:    { flex: 1, backgroundColor: C.bg },
  content: { paddingHorizontal: 12, paddingTop: 12 },

  // The web's OUTER_CARD and INNER_CARD.
  outer: {
    gap: 16, padding: 16, borderRadius: 10, borderWidth: 0.5, borderColor: C.line, backgroundColor: C.outer,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.25, shadowRadius: 4, elevation: 4,
  },
  card:       { borderRadius: 10, borderWidth: 0.5, borderColor: C.line, padding: 16 },
  center:     { alignItems: 'center', gap: 12 },
  cardHeader: { gap: 6, marginBottom: 16 },
  cardTitle:  { color: C.white, fontSize: 18, lineHeight: 22, fontFamily: FONTS.darker.regular },
  asideNote:  { color: C.faint, fontSize: 14, lineHeight: 19, fontFamily: FONTS.darker.regular },

  meta:       { alignItems: 'center', gap: 4, paddingVertical: 20 },
  avatar:     {
    width: 80, height: 80, borderRadius: 40, backgroundColor: C.cyan,
    alignItems: 'center', justifyContent: 'center', marginBottom: 14,
  },
  avatarText: { color: C.bg, fontSize: 26, fontFamily: FONTS.darker.bold },
  metaName:   { color: C.white, fontSize: 21, lineHeight: 25, textAlign: 'center', fontFamily: FONTS.darker.bold },
  metaRole:   { color: C.faint, fontSize: 15, textAlign: 'center', fontFamily: FONTS.darker.regular },

  fields:     { gap: 16 },
  field:      { minWidth: 0 },
  fieldLabel: { color: C.faint, fontSize: 13, marginBottom: 4, fontFamily: FONTS.darker.regular },
  fieldValue: { color: C.white, fontSize: 15, fontFamily: FONTS.darker.medium },

  actionRow:   { gap: 4 },
  actionTitle: { color: C.white, fontSize: 16, fontFamily: FONTS.darker.medium },
  actionHint:  { color: C.faint, fontSize: 14, lineHeight: 19, marginBottom: 8, fontFamily: FONTS.darker.regular },
  email:       { color: C.soft },
  divider:     { height: 0.5, backgroundColor: C.line, marginVertical: 16 },

  // The web's BUTTON: bordered, full width on a phone.
  button:     {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    minHeight: 44, borderRadius: 8, borderWidth: 0.5, borderColor: C.line, paddingHorizontal: 16, alignSelf: 'stretch',
  },
  buttonText: { color: C.white, fontSize: 15, fontFamily: FONTS.darker.medium },

  sentBox:     {
    marginTop: 12, borderRadius: 8, borderWidth: 0.5, borderColor: C.cyanLn, backgroundColor: C.cyanBg,
    paddingHorizontal: 14, paddingVertical: 12,
  },
  sentText:    { color: C.soft, fontSize: 15, lineHeight: 20, fontFamily: FONTS.darker.regular },
  inlineError: { color: C.red, fontSize: 14, marginTop: 10, fontFamily: FONTS.darker.regular },
  errorText:   { color: C.soft, fontSize: 16, textAlign: 'center', fontFamily: FONTS.darker.regular },

  signOut:     {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    minHeight: 48, borderRadius: 8, borderWidth: 0.5, borderColor: C.redLn, backgroundColor: C.redBg,
  },
  signOutText: { color: C.red, fontSize: 16, fontFamily: FONTS.darker.bold },
})
