import { useCallback, useEffect, useState } from 'react'
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native'
import { router, useLocalSearchParams } from 'expo-router'

import {
  BG_CARD, BG_MAIN, CYAN, ERROR, MUTED,
  PasswordField, RequirementRow, REQUIREMENTS, StrengthBar,
  getStrength, meetsRequirements,
} from '../../components/auth/password-fields'
import { completePasswordReset, verifyResetToken } from '../../lib/api/auth.api'

/**
 * The screen a driver's emailed reset link opens.
 *
 * Drivers are the one group who never touch the web app — they are handed a
 * phone and this is the whole of their software — so sending them to a browser
 * to get back in was the odd step out. The link still lands on the web page
 * first (an email client cannot be trusted to follow a custom scheme, and the
 * phone may not have the app installed), and that page hands off to
 * logistics-mobile://reset-password?token=..., which is this.
 *
 * Everyone else keeps the web page: they have a desk and a browser, and an
 * admin resetting a password is already sitting in one.
 *
 * Public by necessity. Whoever opens this has no session — that is the point —
 * so nothing here reads the auth store, and the two endpoints it calls are
 * excluded from the token interceptor.
 */

type TokenState = 'checking' | 'valid' | 'invalid'

function extractMessage(err: unknown, fallback: string): string {
  const res = (err as { response?: { data?: { message?: string } } })?.response
  return res?.data?.message ?? (err instanceof Error ? err.message : fallback)
}

export default function ResetPasswordScreen() {
  // Expo Router hands us the query string off the deep link.
  const { token: rawToken } = useLocalSearchParams<{ token?: string }>()
  const token = typeof rawToken === 'string' ? rawToken : ''

  const [tokenState,   setTokenState]   = useState<TokenState>('checking')
  const [maskedEmail,  setMaskedEmail]  = useState<string | null>(null)
  const [password,     setPassword]     = useState('')
  const [confirmPw,    setConfirmPw]    = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirm,  setShowConfirm]  = useState(false)
  const [submitting,   setSubmitting]   = useState(false)
  const [error,        setError]        = useState<string | null>(null)
  const [done,         setDone]         = useState(false)

  const strength       = getStrength(password)
  const allMet         = meetsRequirements(password)
  const passwordsMatch = password === confirmPw && confirmPw.length > 0
  const canSubmit      = allMet && passwordsMatch && !submitting

  // Check the token before showing the form, so an expired or already-spent
  // link says so instead of taking a password and then failing.
  useEffect(() => {
    if (!token) { setTokenState('invalid'); return }

    let cancelled = false
    verifyResetToken(token)
      .then((res) => {
        if (cancelled) return
        setTokenState(res.valid ? 'valid' : 'invalid')
        setMaskedEmail(res.email ?? null)
      })
      .catch(() => { if (!cancelled) setTokenState('invalid') })

    return () => { cancelled = true }
  }, [token])

  const submit = useCallback(async () => {
    if (!canSubmit) return
    setSubmitting(true)
    setError(null)
    try {
      await completePasswordReset(token, password)
      setDone(true)
    } catch (err) {
      setError(extractMessage(err, 'Could not reset your password. Try again.'))
    } finally {
      setSubmitting(false)
    }
  }, [canSubmit, token, password])

  /* Token still being checked */
  if (tokenState === 'checking') {
    return (
      <View style={{ flex: 1, backgroundColor: BG_MAIN, alignItems: 'center', justifyContent: 'center', gap: 14 }}>
        <ActivityIndicator size="large" color={CYAN} />
        <Text style={{ color: MUTED, fontSize: 13 }}>Checking your link…</Text>
      </View>
    )
  }

  /* Dead link */
  if (tokenState === 'invalid') {
    return (
      <View style={{ flex: 1, backgroundColor: BG_MAIN, alignItems: 'center', justifyContent: 'center', gap: 16, paddingHorizontal: 28 }}>
        <Text style={{ color: '#fff', fontSize: 18, fontWeight: '800', letterSpacing: 2, textTransform: 'uppercase', textAlign: 'center' }}>
          Link expired
        </Text>
        <Text style={{ color: MUTED, fontSize: 13, textAlign: 'center', lineHeight: 19 }}>
          This reset link is invalid or has already been used. Ask the Company Administrator to
          send you a new one.
        </Text>
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

  /* Done */
  if (done) {
    return (
      <View style={{ flex: 1, backgroundColor: BG_MAIN, alignItems: 'center', justifyContent: 'center', gap: 18, paddingHorizontal: 28 }}>
        <View style={{
          width: 80, height: 80, borderRadius: 40,
          backgroundColor: 'rgba(77,249,237,0.08)',
          borderWidth: 1, borderColor: 'rgba(77,249,237,0.25)',
          alignItems: 'center', justifyContent: 'center',
        }}>
          <Text style={{ fontSize: 32 }}>✓</Text>
        </View>
        <Text style={{ color: '#fff', fontSize: 20, fontWeight: '800', letterSpacing: 3, textTransform: 'uppercase', textAlign: 'center' }}>
          Password Reset
        </Text>
        <Text style={{ color: MUTED, fontSize: 13, textAlign: 'center', lineHeight: 19 }}>
          Sign in with your new password.
        </Text>
        <Pressable
          onPress={() => router.replace('/sign-in')}
          style={({ pressed }) => ({
            marginTop: 4, paddingVertical: 13, paddingHorizontal: 34, borderRadius: 10,
            backgroundColor: CYAN, opacity: pressed ? 0.8 : 1,
          })}
        >
          <Text style={{ color: '#062b28', fontSize: 13, fontWeight: '800', letterSpacing: 1.5 }}>
            SIGN IN
          </Text>
        </Pressable>
      </View>
    )
  }

  /* The form */
  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: BG_MAIN }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: 24, gap: 18 }}
        keyboardShouldPersistTaps="handled"
      >
        <View style={{ gap: 6 }}>
          <Text style={{ color: '#fff', fontSize: 22, fontWeight: '800', letterSpacing: 2.5, textTransform: 'uppercase' }}>
            Set a new password
          </Text>
          <Text style={{ color: MUTED, fontSize: 12, lineHeight: 18 }}>
            {maskedEmail
              ? `For ${maskedEmail}. This link can only be used once.`
              : 'This link can only be used once.'}
          </Text>
        </View>

        <View style={{
          backgroundColor: BG_CARD,
          borderRadius: 16,
          borderWidth: 1,
          borderColor: 'rgba(255,255,255,0.07)',
          padding: 18,
          gap: 16,
        }}>
          <View style={{ gap: 4 }}>
            <PasswordField
              label="New Password"
              value={password}
              onChange={(v) => { setPassword(v); setError(null) }}
              placeholder="Create a strong password"
              showPassword={showPassword}
              onToggleShow={() => setShowPassword((v) => !v)}
              autoFocus
            />
            {password.length > 0 && <StrengthBar strength={strength} />}
          </View>

          <View style={{ gap: 4 }}>
            <PasswordField
              label="Confirm Password"
              value={confirmPw}
              onChange={(v) => { setConfirmPw(v); setError(null) }}
              placeholder="Repeat your password"
              showPassword={showConfirm}
              onToggleShow={() => setShowConfirm((v) => !v)}
              borderColor={
                confirmPw.length > 0 && !passwordsMatch ? 'rgba(248,113,113,0.5)' : undefined
              }
            />
            {confirmPw.length > 0 && !passwordsMatch && (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 }}>
                <View style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: ERROR }} />
                <Text style={{ color: 'rgba(248,113,113,0.8)', fontSize: 10 }}>
                  Passwords do not match
                </Text>
              </View>
            )}
          </View>

          <View style={{ gap: 1 }}>
            {REQUIREMENTS.map((r) => (
              <RequirementRow key={r.label} label={r.label} met={r.test(password)} />
            ))}
          </View>

          {!!error && (
            <View style={{
              paddingVertical: 9, paddingHorizontal: 12, borderRadius: 9,
              backgroundColor: 'rgba(248,113,113,0.1)',
              borderWidth: 1, borderColor: 'rgba(248,113,113,0.3)',
            }}>
              <Text style={{ color: ERROR, fontSize: 11, lineHeight: 16 }}>{error}</Text>
            </View>
          )}

          <Pressable
            onPress={submit}
            disabled={!canSubmit}
            accessibilityRole="button"
            accessibilityLabel="Set your new password"
            style={({ pressed }) => ({
              paddingVertical: 14,
              borderRadius: 10,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: canSubmit ? CYAN : 'rgba(255,255,255,0.08)',
              opacity: pressed && canSubmit ? 0.85 : 1,
            })}
          >
            {submitting ? (
              <ActivityIndicator size="small" color="#062b28" />
            ) : (
              <Text style={{
                color: canSubmit ? '#062b28' : 'rgba(255,255,255,0.3)',
                fontSize: 13, fontWeight: '800', letterSpacing: 1.5,
              }}>
                RESET PASSWORD
              </Text>
            )}
          </Pressable>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  )
}
