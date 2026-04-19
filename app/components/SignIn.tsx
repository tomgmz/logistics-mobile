import React, { useCallback, useEffect, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Animated,
  Easing,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { MotiView, AnimatePresence } from 'moti'
import { MaterialIcons } from '@expo/vector-icons'
import { router } from 'expo-router'

import {
  getAuthStatus,
  getMe,
  requestOtp,
  verifyOtp,
} from '../../lib/api/auth.api'
import { useAuthStore } from '../../lib/store/auth.store'

const C = {
  bg:          '#080808',
  surface:     '#111111',
  surfaceHigh: '#1a1a1a',
  border:      '#242424',
  borderFocus: '#4df9ed',
  cyan:        '#4df9ed',
  cyanDim:     'rgba(77,249,237,0.12)',
  cyanGlow:    'rgba(77,249,237,0.06)',
  text:        '#f0f0f0',
  textMuted:   '#6b6b6b',
  textSub:     '#404040',
  error:       '#ff4d4d',
  errorDim:    'rgba(255,77,77,0.1)',
  success:     '#3af626',
}

function OtpBox({
  value,
  focused,
  hasError,
}: {
  value:    string
  focused:  boolean
  hasError: boolean
}) {
  const pulse = useRef(new Animated.Value(1)).current

  useEffect(() => {
    if (focused) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulse, { toValue: 0, duration: 500, easing: Easing.ease, useNativeDriver: true }),
          Animated.timing(pulse, { toValue: 1, duration: 500, easing: Easing.ease, useNativeDriver: true }),
        ])
      ).start()
    } else {
      pulse.stopAnimation()
      pulse.setValue(1)
    }
  }, [focused])

  return (
    <View
      style={[
        styles.otpBox,
        focused && styles.otpBoxFocused,
        hasError && styles.otpBoxError,
        value && !focused && styles.otpBoxFilled,
      ]}
    >
      {value ? (
        <Text style={[styles.otpDigit, hasError && { color: C.error }]}>{value}</Text>
      ) : focused ? (
        <Animated.View style={[styles.otpCursor, { opacity: pulse }]} />
      ) : null}
    </View>
  )
}

function ResendTimer({
  onResend,
  email,
}: {
  onResend: () => void
  email:    string
}) {
  const [seconds,   setSeconds]   = useState(30)
  const [resending, setResending] = useState(false)

  useEffect(() => {
    if (seconds <= 0) return
    const t = setTimeout(() => setSeconds(s => s - 1), 1000)
    return () => clearTimeout(t)
  }, [seconds])

  const handleResend = async () => {
    setResending(true)
    try {
      await requestOtp(email)
      setSeconds(30)
    } finally {
      setResending(false)
    }
  }

  if (seconds > 0) {
    return (
      <Text style={styles.resendText}>
        Resend code in <Text style={{ color: C.cyan }}>{seconds}s</Text>
      </Text>
    )
  }

  return (
    <TouchableOpacity onPress={handleResend} disabled={resending}>
      <Text style={[styles.resendText, { color: C.cyan }]}>
        {resending ? 'Sending…' : 'Resend code'}
      </Text>
    </TouchableOpacity>
  )
}

type Step = 'email' | 'otp'

export default function SignInScreen() {
  const insets  = useSafeAreaInsets()
  const setUser = useAuthStore((s) => s.setUser)
  const setTokens = useAuthStore((s) => s.setTokens)

  const [step,        setStep]        = useState<Step>('email')
  const [email,       setEmail]       = useState('')
  const [otp,         setOtp]         = useState('')
  const [loading,     setLoading]     = useState(false)
  const [error,       setError]       = useState<string | null>(null)
  const [lockedUntil, setLockedUntil] = useState<string | null>(null)

  const emailRef = useRef<TextInput>(null)
  const otpRef   = useRef<TextInput>(null)

  useEffect(() => {
    if (step === 'otp') {
      setTimeout(() => otpRef.current?.focus(), 400)
    }
  }, [step])

  const handleEmailSubmit = useCallback(async () => {
    const trimmed = email.trim().toLowerCase()
    if (!trimmed || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setError('Enter a valid email address')
      return
    }

    setError(null)
    setLoading(true)

    try {
      const status = await getAuthStatus(trimmed)

      if (status.locked) {
        if (status.permanent) {
          setError('This account has been permanently locked. Contact support.')
          return
        }
        const until = status.locked_until
          ? new Date(status.locked_until).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
          : null
        setLockedUntil(until)
        setError(`Account locked${until ? ` until ${until}` : ''}. Try again later.`)
        return
      }

      await requestOtp(trimmed)
      setEmail(trimmed)
      setStep('otp')
    } catch (err: any) {
      setError(err?.response?.data?.message ?? 'Something went wrong. Try again.')
    } finally {
      setLoading(false)
    }
  }, [email])

  const handleOtpSubmit = useCallback(async (code: string) => {
    if (code.length !== 6) return
    setError(null)
    setLoading(true)

    try {
      const auth = await verifyOtp(email, code)

      setUser(auth.user)
      setTokens(auth.accessToken, auth.refreshToken)
      const me = await getMe()
      setUser(me)

      const role = me.role
      if (role === 'admin') {
        router.replace('/admin')
      } else if (role === 'assistant_driver') {
        router.replace('/assistant-driver')
      } else if (role === 'driver') {
        router.replace('/driver')
      } else {
        router.replace('/(tabs)/')
      }

    } catch (err: any) {
      const msg: string = err?.response?.data?.message ?? 'Invalid code. Try again.'
      setError(msg)
      setOtp('')
      setTimeout(() => otpRef.current?.focus(), 100)
    } finally {
      setLoading(false)
    }
  }, [email, setUser])

  const handleOtpChange = (text: string) => {
    const digits = text.replace(/\D/g, '').slice(0, 6)
    setOtp(digits)
    setError(null)
    if (digits.length === 6) handleOtpSubmit(digits)
  }

  const handleBack = () => {
    setStep('email')
    setOtp('')
    setError(null)
    setLockedUntil(null)
  }

  const hasOtpError = !!error && step === 'otp'

  return (
    <KeyboardAvoidingView
      style={[styles.root, { paddingTop: insets.top, paddingBottom: insets.bottom }]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        {[...Array(8)].map((_, i) => (
          <View key={i} style={[styles.gridLine, { top: `${(i + 1) * 12}%` }]} />
        ))}
      </View>

      <View style={styles.cornerAccentTL} pointerEvents="none" />
      <View style={styles.cornerAccentBR} pointerEvents="none" />

      <View style={styles.inner}>

        <MotiView
          from={{ opacity: 0, translateY: -16 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'timing', duration: 600 }}
          style={styles.brandWrap}
        >
          <View style={styles.logoMark}>
            <View style={styles.logoInner} />
          </View>
          <Text style={styles.brandName}>8338 LOGISTICS</Text>
          <Text style={styles.brandTagline}>Fleet · Routes · Delivery</Text>
        </MotiView>

        <MotiView
          from={{ opacity: 0, translateY: 24 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'timing', duration: 500, delay: 150 }}
          style={styles.card}
        >
          <View style={styles.cardAccent} />

          <AnimatePresence exitBeforeEnter>
            {step === 'email' ? (
              <MotiView
                key="email-header"
                from={{ opacity: 0, translateX: -12 }}
                animate={{ opacity: 1, translateX: 0 }}
                exit={{ opacity: 0, translateX: 12 }}
                transition={{ type: 'timing', duration: 250 }}
              >
                <Text style={styles.stepTitle}>Sign In</Text>
                <Text style={styles.stepSub}>Enter your email to receive a login code</Text>
              </MotiView>
            ) : (
              <MotiView
                key="otp-header"
                from={{ opacity: 0, translateX: 12 }}
                animate={{ opacity: 1, translateX: 0 }}
                exit={{ opacity: 0, translateX: -12 }}
                transition={{ type: 'timing', duration: 250 }}
              >
                <TouchableOpacity onPress={handleBack} style={styles.backRow}>
                  <MaterialIcons name="arrow-back" size={14} color={C.cyan} />
                  <Text style={styles.backRowText}>Change email</Text>
                </TouchableOpacity>
                <Text style={styles.stepTitle}>Check your email</Text>
                <Text style={styles.stepSub}>
                  We sent a 6-digit code to{'\n'}
                  <Text style={{ color: C.cyan }}>{email}</Text>
                </Text>
              </MotiView>
            )}
          </AnimatePresence>

          <AnimatePresence exitBeforeEnter>
            {step === 'email' && (
              <MotiView
                key="email-form"
                from={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ type: 'timing', duration: 200 }}
                style={{ marginTop: 24 }}
              >
                <Text style={styles.label}>Email address</Text>
                <View style={[styles.inputWrap, error && styles.inputWrapError]}>
                  <MaterialIcons name="mail-outline" size={16} color={C.textMuted} style={styles.inputIcon} />
                  <TextInput
                    ref={emailRef}
                    value={email}
                    onChangeText={t => { setEmail(t); setError(null) }}
                    placeholder="you@company.com"
                    placeholderTextColor={C.textSub}
                    keyboardType="email-address"
                    autoCapitalize="none"
                    autoCorrect={false}
                    autoComplete="email"
                    returnKeyType="go"
                    onSubmitEditing={handleEmailSubmit}
                    style={styles.input}
                    selectionColor={C.cyan}
                  />
                </View>

                {error && (
                  <MotiView
                    from={{ opacity: 0, translateY: -4 }}
                    animate={{ opacity: 1, translateY: 0 }}
                    style={styles.errorRow}
                  >
                    <MaterialIcons name="error-outline" size={13} color={C.error} />
                    <Text style={styles.errorText}>{error}</Text>
                  </MotiView>
                )}

                <TouchableOpacity
                  style={[styles.btn, loading && styles.btnDisabled]}
                  onPress={handleEmailSubmit}
                  disabled={loading}
                  activeOpacity={0.85}
                >
                  {loading ? (
                    <ActivityIndicator size="small" color={C.bg} />
                  ) : (
                    <>
                      <Text style={styles.btnText}>Continue</Text>
                      <MaterialIcons name="arrow-forward" size={16} color={C.bg} />
                    </>
                  )}
                </TouchableOpacity>
              </MotiView>
            )}

            {step === 'otp' && (
              <MotiView
                key="otp-form"
                from={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ type: 'timing', duration: 200 }}
                style={{ marginTop: 28 }}
              >
                <TextInput
                  ref={otpRef}
                  value={otp}
                  onChangeText={handleOtpChange}
                  keyboardType="number-pad"
                  maxLength={6}
                  style={styles.hiddenInput}
                  caretHidden
                  autoComplete="one-time-code"
                />

                <Pressable
                  onPress={() => {
                    otpRef.current?.blur()
                    setTimeout(() => otpRef.current?.focus(), 50)
                  }}
                  style={styles.otpRow}
                >
                  {[...Array(6)].map((_, i) => (
                    <OtpBox
                      key={i}
                      value={otp[i] ?? ''}
                      focused={otp.length === i && !loading}
                      hasError={hasOtpError}
                    />
                  ))}
                </Pressable>

                {error && (
                  <MotiView
                    from={{ opacity: 0, translateY: -4 }}
                    animate={{ opacity: 1, translateY: 0 }}
                    style={[styles.errorRow, { justifyContent: 'center', marginTop: 12 }]}
                  >
                    <MaterialIcons name="error-outline" size={13} color={C.error} />
                    <Text style={styles.errorText}>{error}</Text>
                  </MotiView>
                )}

                {loading && (
                  <MotiView
                    from={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    style={styles.verifyingRow}
                  >
                    <ActivityIndicator size="small" color={C.cyan} />
                    <Text style={styles.verifyingText}>Verifying…</Text>
                  </MotiView>
                )}

                <View style={styles.resendRow}>
                  <ResendTimer onResend={() => {}} email={email} />
                </View>

                {otp.length === 6 && !loading && (
                  <TouchableOpacity
                    style={styles.btn}
                    onPress={() => handleOtpSubmit(otp)}
                    activeOpacity={0.85}
                  >
                    <Text style={styles.btnText}>Verify Code</Text>
                    <MaterialIcons name="check" size={16} color={C.bg} />
                  </TouchableOpacity>
                )}
              </MotiView>
            )}
          </AnimatePresence>
        </MotiView>

        {/* Footer */}
        <MotiView
          from={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ type: 'timing', duration: 600, delay: 400 }}
          style={styles.footer}
        >
          <View style={styles.footerDot} />
          <Text style={styles.footerText}>Secure · Passwordless · OTP</Text>
          <View style={styles.footerDot} />
        </MotiView>

      </View>
    </KeyboardAvoidingView>
  )
}

const styles = StyleSheet.create({
  root: {
    flex:            1,
    backgroundColor: C.bg,
  },
  inner: {
    flex:              1,
    justifyContent:    'center',
    paddingHorizontal: 24,
  },

  gridLine: {
    position:        'absolute',
    left: 0, right:  0,
    height:          1,
    backgroundColor: 'rgba(255,255,255,0.025)',
  },

  cornerAccentTL: {
    position:        'absolute',
    top: 0, left:    0,
    width:           120,
    height:          120,
    borderTopWidth:  1,
    borderLeftWidth: 1,
    borderColor:     'rgba(77,249,237,0.15)',
  },
  cornerAccentBR: {
    position:           'absolute',
    bottom: 0, right:   0,
    width:              120,
    height:             120,
    borderBottomWidth:  1,
    borderRightWidth:   1,
    borderColor:        'rgba(77,249,237,0.15)',
  },

  brandWrap: {
    alignItems:   'center',
    marginBottom: 36,
  },
  logoMark: {
    width:           48,
    height:          48,
    borderRadius:    14,
    backgroundColor: C.cyanDim,
    borderWidth:     1,
    borderColor:     'rgba(77,249,237,0.3)',
    alignItems:      'center',
    justifyContent:  'center',
    marginBottom:    14,
  },
  logoInner: {
    width:           20,
    height:          20,
    borderRadius:    5,
    backgroundColor: C.cyan,
    opacity:         0.9,
  },
  brandName: {
    color:         C.text,
    fontSize:      17,
    fontWeight:    '800',
    letterSpacing: 4,
    marginBottom:  4,
  },
  brandTagline: {
    color:         C.textMuted,
    fontSize:      11,
    letterSpacing: 2,
    textTransform: 'uppercase',
  },

  card: {
    backgroundColor: C.surface,
    borderRadius:    20,
    borderWidth:     1,
    borderColor:     C.border,
    padding:         24,
    paddingTop:      0,
    overflow:        'hidden',
  },
  cardAccent: {
    height:           2,
    backgroundColor:  C.cyan,
    marginHorizontal: -1,
    marginBottom:     24,
    opacity:          0.7,
  },

  backRow: {
    flexDirection: 'row',
    alignItems:    'center',
    gap:           4,
    marginBottom:  14,
  },
  backRowText: {
    color:    C.cyan,
    fontSize: 12,
  },
  stepTitle: {
    color:         C.text,
    fontSize:      22,
    fontWeight:    '700',
    letterSpacing: -0.3,
    marginBottom:  6,
  },
  stepSub: {
    color:      C.textMuted,
    fontSize:   13,
    lineHeight: 20,
  },

  label: {
    color:         C.textMuted,
    fontSize:      11,
    fontWeight:    '600',
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginBottom:  8,
  },
  inputWrap: {
    flexDirection:     'row',
    alignItems:        'center',
    backgroundColor:   C.surfaceHigh,
    borderRadius:      12,
    borderWidth:       1,
    borderColor:       C.border,
    paddingHorizontal: 14,
    height:            52,
    marginBottom:      4,
  },
  inputWrapError: {
    borderColor:     C.error,
    backgroundColor: C.errorDim,
  },
  inputIcon: {
    marginRight: 10,
  },
  input: {
    flex:          1,
    color:         C.text,
    fontSize:      15,
    paddingVertical: 0,
  },

  errorRow: {
    flexDirection: 'row',
    alignItems:    'center',
    gap:           5,
    marginTop:     6,
    marginBottom:  2,
  },
  errorText: {
    color:    C.error,
    fontSize: 12,
    flex:     1,
  },

  btn: {
    flexDirection:  'row',
    alignItems:     'center',
    justifyContent: 'center',
    gap:            8,
    backgroundColor: C.cyan,
    borderRadius:   12,
    height:         52,
    marginTop:      20,
  },
  btnDisabled: {
    opacity: 0.6,
  },
  btnText: {
    color:         C.bg,
    fontSize:      15,
    fontWeight:    '800',
    letterSpacing: 0.3,
  },

  hiddenInput: {
    position: 'absolute',
    opacity:  0,
    width:    1,
    height:   1,
  },
  otpRow: {
    flexDirection:  'row',
    justifyContent: 'space-between',
    gap:            8,
  },
  otpBox: {
    flex:            1,
    height:          56,
    borderRadius:    12,
    borderWidth:     1.5,
    borderColor:     C.border,
    backgroundColor: C.surfaceHigh,
    alignItems:      'center',
    justifyContent:  'center',
  },
  otpBoxFocused: {
    borderColor:     C.cyan,
    backgroundColor: C.cyanGlow,
  },
  otpBoxFilled: {
    borderColor:     'rgba(77,249,237,0.3)',
    backgroundColor: C.cyanDim,
  },
  otpBoxError: {
    borderColor:     C.error,
    backgroundColor: C.errorDim,
  },
  otpDigit: {
    color:      C.text,
    fontSize:   22,
    fontWeight: '700',
  },
  otpCursor: {
    width:           2,
    height:          24,
    backgroundColor: C.cyan,
    borderRadius:    1,
  },

  verifyingRow: {
    flexDirection:  'row',
    alignItems:     'center',
    justifyContent: 'center',
    gap:            8,
    marginTop:      16,
  },
  verifyingText: {
    color:    C.cyan,
    fontSize: 13,
  },

  resendRow: {
    alignItems: 'center',
    marginTop:  20,
  },
  resendText: {
    color:    C.textMuted,
    fontSize: 13,
  },

  footer: {
    flexDirection:  'row',
    alignItems:     'center',
    justifyContent: 'center',
    gap:            10,
    marginTop:      32,
  },
  footerDot: {
    width:           3,
    height:          3,
    borderRadius:    1.5,
    backgroundColor: C.textSub,
  },
  footerText: {
    color:         C.textSub,
    fontSize:      11,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
  },
})