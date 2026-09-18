import { useCallback, useEffect, useState } from 'react'
import { ActivityIndicator, Pressable, Text, View } from 'react-native'
import { router, useLocalSearchParams } from 'expo-router'

import { BG_MAIN, CYAN, ERROR, MUTED } from '../../components/auth/password-fields'
import {
  verifyEnrollmentInvite,
  passkeyEnrollOptions,
  passkeyEnrollVerify,
  getMe,
} from '../../lib/api/auth.api'
import { useAuthStore } from '../../lib/store/auth.store'
import {
  checkPasskeySupport,
  createPasskey,
  deviceLabel,
  PasskeyCancelled,
} from '../../lib/passkeys'
import { getMobileRoute } from '../../lib/config/roleRoutes'

/**
 * Passkey setup, for a driver from an outside vendor.
 *
 * These drivers have no password — there is nothing to issue, nothing to email,
 * and nothing to leak. Instead ops gives them app access on a booking, they get
 * a one-time link, and this screen turns that link into a passkey held in their
 * own phone's secure hardware. The private key never leaves the handset; the
 * server only ever sees the public half.
 *
 * The emailed link lands on the web app first, which hands off to
 * logistics-mobile://driver-setup?token=... — the same indirection the driver
 * password-reset flow uses, and for the same two reasons: an email client cannot
 * be trusted to follow a custom scheme, and the phone may not have the app
 * installed yet.
 *
 * Public by necessity: whoever opens this has no session, which is the point.
 * Nothing here reads the auth store on the way in, and the endpoints it calls
 * are excluded from the token interceptor.
 */

type InviteState = 'checking' | 'valid' | 'invalid' | 'unsupported'

function extractMessage(err: unknown, fallback: string): string {
  const res = (err as { response?: { data?: { message?: string } } })?.response
  return res?.data?.message ?? (err instanceof Error ? err.message : fallback)
}

export default function DriverSetupScreen() {
  const { token: rawToken } = useLocalSearchParams<{ token?: string }>()
  const token = typeof rawToken === 'string' ? rawToken : ''

  const setUser = useAuthStore((s) => s.setUser)

  const [state,      setState]      = useState<InviteState>('checking')
  const [firstName,  setFirstName]  = useState<string | null>(null)
  const [email,      setEmail]      = useState<string | null>(null)
  const [blocker,    setBlocker]    = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error,      setError]      = useState<string | null>(null)

  // Two checks before the driver is shown a button, in this order.
  //
  // The phone's capability comes first: if it cannot hold a passkey at all, that
  // is worth saying immediately rather than after a round trip that ends in the
  // same refusal. Then the link, so an expired one says so before the driver has
  // been through a biometric prompt for nothing.
  useEffect(() => {
    const support = checkPasskeySupport()
    if (!support.supported) {
      setBlocker(support.message)
      setState('unsupported')
      return
    }

    if (!token) { setState('invalid'); return }

    let cancelled = false
    verifyEnrollmentInvite(token)
      .then((res) => {
        if (cancelled) return
        setState(res.valid ? 'valid' : 'invalid')
        setFirstName(res.firstName ?? null)
        setEmail(res.emailMasked ?? null)
      })
      .catch(() => { if (!cancelled) setState('invalid') })

    return () => { cancelled = true }
  }, [token])

  const enroll = useCallback(async () => {
    if (submitting) return
    setSubmitting(true)
    setError(null)
    try {
      const options    = await passkeyEnrollOptions(token)
      const credential = await createPasskey(options)
      const auth       = await passkeyEnrollVerify(token, credential, deviceLabel())

      // Signed in already — passkeyEnrollVerify stored the tokens. Pull the full
      // profile so the driver block (driver_id and the rest) is in the store
      // before any screen that needs it renders.
      const me = await getMe().catch(() => auth.user)
      setUser(me as any)
      router.replace(getMobileRoute((me as any)?.role ?? 'driver'))
    } catch (err) {
      // A dismissed prompt is not a failure. The driver may have tapped the
      // wrong finger or thought better of it; leave the screen as it was so they
      // can simply try again.
      if (err instanceof PasskeyCancelled) {
        setSubmitting(false)
        return
      }
      setError(extractMessage(err, 'Could not finish setting up your sign-in. Please try again.'))
      setSubmitting(false)
    }
  }, [submitting, token, setUser])

  if (state === 'checking') {
    return (
      <View style={{ flex: 1, backgroundColor: BG_MAIN, alignItems: 'center', justifyContent: 'center', gap: 14 }}>
        <ActivityIndicator size="large" color={CYAN} />
        <Text style={{ color: MUTED, fontSize: 13 }}>Checking your link…</Text>
      </View>
    )
  }

  // This phone cannot do it, and nothing the driver does will change that. Say
  // who can fix it rather than leaving them tapping a button that will not work.
  if (state === 'unsupported') {
    return (
      <Centered title="Phone not supported">
        <Text style={{ color: MUTED, fontSize: 13, textAlign: 'center', lineHeight: 19 }}>
          {blocker}
        </Text>
      </Centered>
    )
  }

  if (state === 'invalid') {
    return (
      <Centered title="Link expired">
        <Text style={{ color: MUTED, fontSize: 13, textAlign: 'center', lineHeight: 19 }}>
          This setup link is invalid or has already been used. Ask your dispatcher
          to send you a new one.
        </Text>
      </Centered>
    )
  }

  return (
    <View style={{ flex: 1, backgroundColor: BG_MAIN, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28, gap: 18 }}>
      <View style={{
        width: 80, height: 80, borderRadius: 40,
        backgroundColor: 'rgba(77,249,237,0.08)',
        borderWidth: 1, borderColor: 'rgba(77,249,237,0.25)',
        alignItems: 'center', justifyContent: 'center',
      }}>
        <Text style={{ fontSize: 32 }}>🔑</Text>
      </View>

      <Text style={{ color: '#fff', fontSize: 20, fontWeight: '800', letterSpacing: 3, textTransform: 'uppercase', textAlign: 'center' }}>
        Set up sign-in
      </Text>

      <Text style={{ color: MUTED, fontSize: 13, textAlign: 'center', lineHeight: 19 }}>
        {firstName ? `Hi ${firstName}. ` : ''}
        You will unlock this app with your fingerprint, face, or phone PIN.
        {'\n\n'}
        There is no password to remember, and nothing is sent to us — the key
        stays on this phone.
      </Text>

      {email && (
        <Text style={{ color: 'rgba(255,255,255,0.22)', fontSize: 11, letterSpacing: 1 }}>
          {email}
        </Text>
      )}

      {error && (
        <Text style={{ color: ERROR, fontSize: 12, textAlign: 'center', lineHeight: 18 }}>
          {error}
        </Text>
      )}

      <Pressable
        onPress={enroll}
        disabled={submitting}
        style={({ pressed }) => ({
          marginTop: 6, paddingVertical: 14, paddingHorizontal: 34, borderRadius: 10,
          borderWidth: 1, borderColor: 'rgba(77,249,237,0.4)',
          backgroundColor: 'rgba(77,249,237,0.06)',
          opacity: pressed || submitting ? 0.6 : 1,
          flexDirection: 'row', alignItems: 'center', gap: 10,
        })}
      >
        {submitting && <ActivityIndicator size="small" color={CYAN} />}
        <Text style={{ color: CYAN, fontSize: 14, fontWeight: '700', letterSpacing: 1 }}>
          {submitting ? 'Setting up…' : 'Set up sign-in'}
        </Text>
      </Pressable>
    </View>
  )
}

/** The dead-end layout, shared by the two states the driver cannot act their way out of. */
function Centered({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={{ flex: 1, backgroundColor: BG_MAIN, alignItems: 'center', justifyContent: 'center', gap: 16, paddingHorizontal: 28 }}>
      <Text style={{ color: '#fff', fontSize: 18, fontWeight: '800', letterSpacing: 2, textTransform: 'uppercase', textAlign: 'center' }}>
        {title}
      </Text>
      {children}
      <Pressable
        onPress={() => router.replace('/sign-in')}
        style={({ pressed }) => ({
          marginTop: 8, paddingVertical: 12, paddingHorizontal: 28, borderRadius: 10,
          borderWidth: 1, borderColor: 'rgba(77,249,237,0.4)', opacity: pressed ? 0.7 : 1,
        })}
      >
        <Text style={{ color: CYAN, fontSize: 13, fontWeight: '700', letterSpacing: 1 }}>
          Back to sign in
        </Text>
      </Pressable>
    </View>
  )
}
