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
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { MaterialIcons } from '@expo/vector-icons'

import {
  listMyPasskeys,
  passkeyRegisterOptions,
  passkeyRegisterVerify,
  removeMyPasskey,
  type MyPasskey,
} from '../../../lib/api/auth.api'
import { useAuthStore } from '../../../lib/store/auth.store'
import {
  checkPasskeySupport,
  createPasskey,
  deviceLabel,
  PasskeyAlreadyOnDevice,
  PasskeyCancelled,
} from '../../../lib/passkeys'
import { FONTS } from '../../../lib/config/fonts'
import { ConfirmDialog } from '../../../components/ui/ConfirmDialog'

/**
 * Passkey sign-in, set up from inside the app.
 *
 * Vendor drivers get their passkey from an emailed setup link (driver-setup).
 * 8338's own drivers are already signed in, so their session is what authorises
 * the passkey: one tap, the phone's fingerprint/face/PIN prompt, done. They keep
 * the emailed code and password; the passkey is a faster way in, not the only one.
 */

const C = {
  bg:     '#000000',
  card:   '#0e1010',
  raised: '#1b1b1b',
  line:   '#424242',
  cyan:   '#4df9ed',
  cyanBg: 'rgba(77,249,237,0.10)',
  cyanLn: 'rgba(77,249,237,0.35)',
  white:  '#ffffff',
  faint:  '#818181',
  red:    '#f62626',
  redBg:  'rgba(246,38,38,0.10)',
  green:  '#3af626',
}

function extractMessage(err: any, fallback: string): string {
  if (!err?.response) {
    return err?.message && !/network/i.test(err.message)
      ? err.message
      : 'Could not reach the server. Check your connection and try again.'
  }
  return err?.response?.data?.message ?? fallback
}

/** "23 Oct 2026". Built by hand so it reads the same whatever Intl data the phone ships. */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
function formatDay(iso: string | null | undefined): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`
}

/** The library's own copy talks to vendor drivers; a company driver always has email sign-in to fall back on. */
function unsupportedMessage(reason: string): string {
  if (reason === 'os-too-old') {
    return 'This phone runs a version of Android that cannot store a passkey (Android 9 or newer is required). Keep signing in with your email.'
  }
  if (reason === 'wrong-platform') {
    return 'Passkey setup is not available on this phone. Keep signing in with your email.'
  }
  return 'This phone cannot set up a passkey. Check that a screen lock (fingerprint, face or PIN) is turned on, then open this page again.'
}

type Notice = { tone: 'ok' | 'info' | 'error'; text: string } | null

export default function PasskeysScreen() {
  const insets     = useSafeAreaInsets()
  const isExternal = useAuthStore((s) => s.user?.drivers?.is_external === true)

  const [support]     = useState(() => checkPasskeySupport())
  const [items,       setItems]       = useState<MyPasskey[]>([])
  const [loading,     setLoading]     = useState(true)
  const [loadError,   setLoadError]   = useState<string | null>(null)
  const [refreshing,  setRefreshing]  = useState(false)
  const [creating,    setCreating]    = useState(false)
  const [notice,      setNotice]      = useState<Notice>(null)
  const [removing,    setRemoving]    = useState<MyPasskey | null>(null)
  const [removeBusy,  setRemoveBusy]  = useState(false)

  const load = useCallback(async () => {
    try {
      setItems(await listMyPasskeys())
      setLoadError(null)
    } catch (err: any) {
      setLoadError(extractMessage(err, 'Could not load your passkeys.'))
    }
  }, [])

  useEffect(() => {
    let alive = true
    load().finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [load])

  const onRefresh = useCallback(async () => {
    setRefreshing(true)
    await load()
    setRefreshing(false)
  }, [load])

  const handleCreate = useCallback(async () => {
    if (creating) return
    setNotice(null)
    setCreating(true)
    try {
      const options    = await passkeyRegisterOptions()
      const credential = await createPasskey(options)
      await passkeyRegisterVerify(credential, deviceLabel())
      setNotice({ tone: 'ok', text: 'Passkey set up. Next time, tap "Sign in with a passkey" on the sign-in screen.' })
      await load()
    } catch (err: any) {
      // Backing out of the phone's prompt is a choice, not a failure.
      if (err instanceof PasskeyCancelled) return
      if (err instanceof PasskeyAlreadyOnDevice) {
        setNotice({ tone: 'info', text: 'This phone already has a passkey for your account. You can use it to sign in.' })
        return
      }
      setNotice({ tone: 'error', text: extractMessage(err, 'Could not set up the passkey. Please try again.') })
    } finally {
      setCreating(false)
    }
  }, [creating, load])

  const handleRemove = useCallback(async () => {
    if (!removing || removeBusy) return
    setRemoveBusy(true)
    try {
      await removeMyPasskey(removing.credential_pk)
      setNotice({ tone: 'ok', text: 'Passkey removed. It can no longer be used to sign in.' })
      await load()
    } catch (err: any) {
      setNotice({ tone: 'error', text: extractMessage(err, 'Could not remove that passkey.') })
    } finally {
      setRemoveBusy(false)
      setRemoving(null)
    }
  }, [removing, removeBusy, load])

  // A vendor driver may not remove their last one: it is their only way in.
  const lastLocked = isExternal && items.length <= 1

  return (
    <View style={styles.root}>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: Math.max(insets.bottom, 16) + 24 }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.cyan} />}
      >
        <View style={styles.hero}>
          <View style={styles.heroIcon}>
            <MaterialIcons name="fingerprint" size={28} color={C.cyan} />
          </View>
          <Text style={styles.heroTitle}>Sign in with a passkey</Text>
          <Text style={styles.heroText}>
            Use your phone's fingerprint, face or screen lock to sign in, with no code to wait
            for and no password to type.
            {isExternal ? '' : ' You can still sign in with your email at any time.'}
          </Text>
        </View>

        {notice && (
          <View
            style={[
              styles.notice,
              notice.tone === 'error' ? styles.noticeError : styles.noticeOk,
            ]}
          >
            <MaterialIcons
              name={notice.tone === 'error' ? 'error-outline' : notice.tone === 'ok' ? 'check-circle' : 'info-outline'}
              size={16}
              color={notice.tone === 'error' ? C.red : notice.tone === 'ok' ? C.green : C.cyan}
              style={{ marginTop: 1 }}
            />
            <Text style={[styles.noticeText, notice.tone === 'error' && { color: C.red }]}>{notice.text}</Text>
          </View>
        )}

        {support.supported ? (
          <TouchableOpacity
            onPress={handleCreate}
            disabled={creating}
            activeOpacity={0.85}
            accessibilityRole="button"
            style={[styles.primaryBtn, creating && { opacity: 0.7 }]}
          >
            {creating ? (
              <ActivityIndicator size="small" color="#080808" />
            ) : (
              <>
                <MaterialIcons name="add" size={18} color="#080808" />
                <Text style={styles.primaryText}>
                  {items.length > 0 ? 'Set up another passkey' : 'Set up a passkey'}
                </Text>
              </>
            )}
          </TouchableOpacity>
        ) : (
          <View style={[styles.notice, styles.noticeMuted]}>
            <MaterialIcons name="info-outline" size={16} color={C.faint} style={{ marginTop: 1 }} />
            <Text style={styles.noticeText}>{unsupportedMessage(support.reason)}</Text>
          </View>
        )}

        <Text style={styles.sectionLabel}>Your passkeys</Text>

        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator color={C.cyan} />
          </View>
        ) : loadError ? (
          <View style={styles.card}>
            <Text style={styles.emptyText}>{loadError}</Text>
            <TouchableOpacity onPress={() => { setLoading(true); load().finally(() => setLoading(false)) }} style={styles.retryBtn}>
              <Text style={styles.retryText}>Try again</Text>
            </TouchableOpacity>
          </View>
        ) : items.length === 0 ? (
          <View style={styles.card}>
            <Text style={styles.emptyText}>No passkeys yet.</Text>
          </View>
        ) : (
          items.map((p) => {
            const added = formatDay(p.created_at)
            const used  = formatDay(p.last_used_at)
            return (
              <View key={p.credential_pk} style={[styles.card, styles.row]}>
                <View style={styles.rowIcon}>
                  <MaterialIcons name="smartphone" size={18} color={C.cyan} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowTitle} numberOfLines={1}>{p.device_label || 'Passkey'}</Text>
                  <Text style={styles.rowMeta}>
                    {[added && `Added ${added}`, used ? `Last used ${used}` : 'Not used yet'].filter(Boolean).join(' · ')}
                  </Text>
                </View>
                {!lastLocked && (
                  <TouchableOpacity
                    onPress={() => setRemoving(p)}
                    hitSlop={8}
                    accessibilityRole="button"
                    accessibilityLabel={`Remove passkey ${p.device_label ?? ''}`}
                    style={styles.removeBtn}
                  >
                    <Text style={styles.removeText}>Remove</Text>
                  </TouchableOpacity>
                )}
              </View>
            )
          })
        )}
      </ScrollView>

      <ConfirmDialog
        visible={!!removing}
        title="Remove this passkey?"
        message={
          isExternal
            ? 'It will stop working for sign-in. Your other passkey keeps working.'
            : 'It will stop working for sign-in. You can still sign in with your email, and set up a new passkey at any time.'
        }
        confirmLabel="Remove"
        tone="red"
        busy={removeBusy}
        onConfirm={handleRemove}
        onCancel={() => { if (!removeBusy) setRemoving(null) }}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  root:    { flex: 1, backgroundColor: C.bg },
  content: { paddingHorizontal: 20, paddingTop: 16 },

  hero:      { alignItems: 'center', marginBottom: 20 },
  heroIcon:  {
    width: 56, height: 56, borderRadius: 18, alignItems: 'center', justifyContent: 'center',
    backgroundColor: C.cyanBg, borderWidth: 1, borderColor: C.cyanLn, marginBottom: 12,
  },
  heroTitle: { color: C.white, fontSize: 22, fontFamily: FONTS.spartan.bold, marginBottom: 6, textAlign: 'center' },
  heroText:  { color: C.faint, fontSize: 14, lineHeight: 20, textAlign: 'center' },

  notice:      {
    flexDirection: 'row', gap: 8, borderRadius: 16, borderWidth: 1,
    paddingHorizontal: 14, paddingVertical: 12, marginBottom: 14,
  },
  noticeOk:    { backgroundColor: C.raised, borderColor: C.line },
  noticeError: { backgroundColor: C.redBg, borderColor: 'rgba(246,38,38,0.35)' },
  noticeMuted: { backgroundColor: C.raised, borderColor: C.line },
  noticeText:  { flex: 1, color: C.white, fontSize: 13, lineHeight: 19 },

  primaryBtn:  {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    height: 48, borderRadius: 24, backgroundColor: C.cyan, marginBottom: 24,
  },
  primaryText: { color: '#080808', fontSize: 15, fontFamily: FONTS.spartan.bold },

  sectionLabel: { color: C.faint, fontSize: 12, fontFamily: FONTS.spartan.semiBold, marginBottom: 8, marginLeft: 4 },
  center:       { paddingVertical: 24, alignItems: 'center' },

  card:      {
    backgroundColor: C.card, borderRadius: 16, borderWidth: 1, borderColor: C.line,
    paddingHorizontal: 14, paddingVertical: 12, marginBottom: 10,
  },
  emptyText: { color: C.faint, fontSize: 13, textAlign: 'center' },
  retryBtn:  { alignSelf: 'center', marginTop: 8, paddingVertical: 6, paddingHorizontal: 12 },
  retryText: { color: C.cyan, fontSize: 13, fontFamily: FONTS.spartan.semiBold },

  row:       { flexDirection: 'row', alignItems: 'center', gap: 12 },
  rowIcon:   {
    width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center',
    backgroundColor: C.cyanBg, borderWidth: 1, borderColor: C.cyanLn,
  },
  rowTitle:  { color: C.white, fontSize: 15, fontFamily: FONTS.spartan.semiBold },
  rowMeta:   { color: C.faint, fontSize: 12, marginTop: 2 },
  removeBtn: {
    borderRadius: 14, borderWidth: 1, borderColor: 'rgba(246,38,38,0.35)',
    paddingHorizontal: 10, paddingVertical: 6,
  },
  removeText: { color: C.red, fontSize: 12, fontFamily: FONTS.spartan.semiBold },
})
