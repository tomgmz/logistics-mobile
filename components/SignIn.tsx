import React, { useCallback, useEffect, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Animated,
  Easing,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { MotiView, AnimatePresence } from 'moti'
import { MaterialIcons } from '@expo/vector-icons'
import { router } from 'expo-router'
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg'

import {
  getAuthStatus,
  getMe,
  loginWithPassword,
  requestOtp,
  requestPasswordReset,
  verifyOtp,
  passkeyAuthOptions,
  passkeyAuthVerify,
} from '../lib/api/auth.api'
import { useAuthStore } from '../lib/store/auth.store'
import { getMobileRoute } from '../lib/config/roleRoutes'
import { checkPasskeySupport, getPasskey, PasskeyCancelled } from '../lib/passkeys'
import { FONTS } from '../lib/config/fonts'

const CYAN  = '#4df9ed'
const MUTED = '#999999'

function formatCountdown(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

function extractMessage(err: any, fallback: string): string {
  return (
    err?.response?.data?.message ??
    err?.data?.message           ??
    err?.message                 ??
    fallback
  )
}

type LockState = 'none' | 'temporary' | 'permanent'
type Step      = 'email' | 'method' | 'otp' | 'password'
type Method    = 'otp' | 'password'
type ResetState = 'idle' | 'sending' | 'sent'

/**
 * Which admin approves this person's reset. Mirrors handlerGroupFor() on the
 * backend: drivers and clients are the Company Admin's, office staff the IT
 * Admin's. On this app it is nearly always a driver, but the label stays honest
 * if another role ever signs in here.
 */
function approverLabel(role?: string | null): string {
  if (!role)                                  return 'Administrator'
  if (role === 'driver' || role === 'client') return 'Company Administrator'
  return 'IT Administrator'
}

function classifyError(message: string): LockState {
  const lower = message.toLowerCase()
  if (lower.includes('permanently locked') || lower.includes('please contact')) return 'permanent'
  if (
    lower.includes('temporarily locked') ||
    lower.includes('account locked')     ||
    lower.includes('too many failed')
  ) return 'temporary'
  return 'none'
}

function OtpBox({
  value,
  focused,
  hasError,
  locked,
}: {
  value:    string
  focused:  boolean
  hasError: boolean
  locked:   boolean
}) {
  const pulse = useRef(new Animated.Value(1)).current

  useEffect(() => {
    if (focused && !locked) {
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
  }, [focused, locked])

  return (
    <View
      className={[
        'flex-1 h-16 rounded-2xl items-center justify-center border-[1.5px]',
        locked    ? 'border-orange-400/40  bg-orange-400/5'   :
        hasError  ? 'border-error          bg-error-dim'      :
        focused   ? 'border-cyan           bg-cyan-glow'      :
        value     ? 'border-cyan-border    bg-cyan-dim'       :
                    'border-surface-border bg-surface-raised',
      ].join(' ')}
    >
      {value ? (
        <Text
          className={`text-[26px] ${
            locked ? 'text-orange-400/60' : hasError ? 'text-error' : 'text-ink-primary'
          }`}
          style={{ fontFamily: FONTS.spartan.bold }}
        >
          {value}
        </Text>
      ) : focused && !locked ? (
        <Animated.View
          className="w-0.5 h-7 rounded-sm bg-cyan"
          style={{ opacity: pulse }}
        />
      ) : null}
    </View>
  )
}

function ResendTimer({
  email,
  disabled,
}: {
  email:    string
  disabled: boolean
}) {
  const expiresAt                 = useRef(Date.now() + 60_000)
  const [seconds,   setSeconds]   = useState(60)
  const [resending, setResending] = useState(false)

  useEffect(() => {
    if (seconds <= 0) return
    const t = setInterval(() => {
      setSeconds(Math.max(0, Math.floor((expiresAt.current - Date.now()) / 1000)))
    }, 500)
    return () => clearInterval(t)
  }, [seconds])

  const handleResend = async () => {
    if (disabled || resending) return
    setResending(true)
    try {
      await requestOtp(email)
      expiresAt.current = Date.now() + 60_000
      setSeconds(60)
    } finally {
      setResending(false)
    }
  }

  if (disabled) return null

  if (seconds > 0) {
    return (
      <Text className="text-[14px] text-ink-muted">
        Resend code in <Text className="text-cyan" style={{ fontVariant: ['tabular-nums'] }}>{seconds}s</Text>
      </Text>
    )
  }

  return (
    <TouchableOpacity onPress={handleResend} disabled={resending} className="flex-row items-center gap-1.5 py-2 px-3">
      <MaterialIcons name="refresh" size={16} color={CYAN} />
      <Text className="text-[14px] text-cyan" style={{ fontFamily: FONTS.spartan.semiBold }}>
        {resending ? 'Sending…' : 'Resend code'}
      </Text>
    </TouchableOpacity>
  )
}

function LockBanner({
  lockState,
  lockRemaining,
  role,
  resetState,
  onRequestReset,
}: {
  lockState:       LockState
  lockRemaining:   number
  role?:           string | null
  resetState:      ResetState
  onRequestReset:  () => void
}) {
  if (lockState === 'none') return null

  if (lockState === 'permanent') {
    return (
      <MotiView
        from={{ opacity: 0, translateY: -4 }}
        animate={{ opacity: 1, translateY: 0 }}
        className="rounded-2xl px-4 py-3.5 mt-4"
        style={{
          backgroundColor: 'rgba(239,68,68,0.08)',
          borderWidth:      1,
          borderColor:      'rgba(239,68,68,0.25)',
        }}
      >
        <View className="flex-row items-center gap-2 mb-1">
          <MaterialIcons name="lock" size={14} color="#ef4444" />
          <Text className="text-[12px] font-semibold tracking-wide uppercase" style={{ color: 'rgba(239,68,68,0.9)' }}>
            Account Permanently Locked
          </Text>
        </View>

        {resetState === 'sent' ? (
          <Text className="text-[12px] leading-5" style={{ color: 'rgba(239,68,68,0.75)' }}>
            Your {approverLabel(role)} has been notified. They will email you a reset link —
            open it to set a new password and unlock your account.
          </Text>
        ) : (
          <>
            <Text className="text-[12px] leading-5 mb-3" style={{ color: 'rgba(239,68,68,0.75)' }}>
              Too many failed attempts. Request a reset and your {approverLabel(role)} will email
              you a link to set a new password.
            </Text>
            <TouchableOpacity
              onPress={onRequestReset}
              disabled={resetState === 'sending'}
              className="rounded-xl py-3 items-center flex-row justify-center gap-2"
              style={{
                backgroundColor: 'rgba(239,68,68,0.16)',
                borderWidth:     1,
                borderColor:     'rgba(239,68,68,0.35)',
                opacity:         resetState === 'sending' ? 0.6 : 1,
              }}
            >
              {resetState === 'sending' ? (
                <ActivityIndicator size="small" color="#ef4444" />
              ) : (
                <>
                  <MaterialIcons name="mail-outline" size={14} color="rgba(239,68,68,0.95)" />
                  <Text className="text-[12px] font-semibold" style={{ color: 'rgba(239,68,68,0.95)' }}>
                    Request a password reset
                  </Text>
                </>
              )}
            </TouchableOpacity>
          </>
        )}
      </MotiView>
    )
  }

  return (
    <MotiView
      from={{ opacity: 0, translateY: -4 }}
      animate={{ opacity: 1, translateY: 0 }}
      className="rounded-2xl px-4 py-3.5 mt-4 flex-row items-center justify-between gap-4"
      style={{
        backgroundColor: 'rgba(251,146,60,0.08)',
        borderWidth:      1,
        borderColor:      'rgba(251,146,60,0.25)',
      }}
    >
      <View className="flex-row items-center gap-2 flex-1">
        <MaterialIcons name="timer" size={14} color="rgba(251,146,60,0.9)" />
        <Text className="text-[12px]" style={{ color: 'rgba(251,146,60,0.85)' }}>
          Account locked. Try again in
        </Text>
      </View>
      <Text
        className="text-[15px] font-bold shrink-0"
        style={{ color: 'rgba(251,146,60,1)', fontVariant: ['tabular-nums'] }}
      >
        {formatCountdown(lockRemaining)}
      </Text>
    </MotiView>
  )
}

function BackButton({ onPress }: { onPress: () => void }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel="Go back"
      className="w-11 h-11 rounded-full items-center justify-center border border-surface-border bg-surface-card"
    >
      <MaterialIcons name="arrow-back" size={20} color="#ffffff" />
    </TouchableOpacity>
  )
}

/** Segmented progress. Drivers take three steps, everyone else two. */
function StepBar({ index, total }: { index: number; total: number }) {
  return (
    <View className="flex-row items-center gap-1.5">
      {[...Array(total)].map((_, i) => (
        <View
          key={i}
          className={`h-1.5 rounded-full ${
            i === index ? 'w-7 bg-cyan' : i < index ? 'w-3 bg-cyan-border' : 'w-3 bg-surface-border'
          }`}
        />
      ))}
    </View>
  )
}

/** The address being signed in as, with a one-tap way to use a different one. */
function EmailChip({ email, onChange }: { email: string; onChange: () => void }) {
  return (
    <View className="flex-row items-center gap-3 rounded-2xl border border-surface-border bg-surface-raised pl-2 pr-1.5 py-2 mb-6">
      <View className="w-9 h-9 rounded-full items-center justify-center bg-cyan-dim border border-cyan-border">
        <Text className="text-[15px] text-cyan" style={{ fontFamily: FONTS.spartan.bold }}>
          {email.charAt(0).toUpperCase()}
        </Text>
      </View>
      <Text numberOfLines={1} className="flex-1 text-[14px] text-ink-secondary">
        {email}
      </Text>
      <TouchableOpacity onPress={onChange} hitSlop={6} className="rounded-xl px-3 py-2 bg-surface-elevated">
        <Text className="text-[13px] text-cyan" style={{ fontFamily: FONTS.spartan.semiBold }}>Change</Text>
      </TouchableOpacity>
    </View>
  )
}

function StepHeading({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <>
      <Text className="text-[30px] leading-[34px] mb-2 text-ink-primary" style={{ fontFamily: FONTS.spartan.bold }}>
        {title}
      </Text>
      {subtitle ? (
        <Text className="text-[15px] leading-[22px] mb-6 text-ink-muted">{subtitle}</Text>
      ) : (
        <View className="h-3" />
      )}
    </>
  )
}

function FieldLabel({ children }: { children: string }) {
  return (
    <Text className="text-[13px] mb-2 text-ink-secondary" style={{ fontFamily: FONTS.spartan.semiBold }}>
      {children}
    </Text>
  )
}

function ErrorRow({ message, center }: { message: string; center?: boolean }) {
  return (
    <MotiView
      from={{ opacity: 0, translateY: -4 }}
      animate={{ opacity: 1, translateY: 0 }}
      className={`flex-row items-center gap-1.5 mt-2 mb-0.5 ${center ? 'justify-center mt-4' : ''}`}
    >
      <MaterialIcons name="error-outline" size={15} color="#ff4d4d" />
      <Text className={`text-[13px] text-error ${center ? '' : 'flex-1'}`}>{message}</Text>
    </MotiView>
  )
}

function InputWrap({
  hasError,
  focused,
  children,
}: {
  hasError: boolean
  focused?: boolean
  children: React.ReactNode
}) {
  return (
    <View
      className={[
        'flex-row items-center rounded-2xl border-[1.5px] px-4 h-[58px] mb-1',
        hasError ? 'border-error bg-error-dim'           :
        focused  ? 'border-cyan bg-cyan-glow'            :
                   'border-surface-border bg-surface-raised',
      ].join(' ')}
    >
      {children}
    </View>
  )
}

function SubmitButton({
  label,
  icon,
  onPress,
  loading,
  disabled,
}: {
  label:     string
  icon:      keyof typeof MaterialIcons.glyphMap
  onPress:   () => void
  loading?:  boolean
  disabled?: boolean
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={loading || disabled}
      activeOpacity={0.85}
      className={`flex-row items-center justify-center gap-2 rounded-2xl h-[58px] mt-5 ${
        disabled ? 'bg-surface-elevated' : 'bg-cyan'
      } ${loading ? 'opacity-70' : 'opacity-100'}`}
      style={disabled ? undefined : {
        shadowColor:   CYAN,
        shadowOpacity: 0.35,
        shadowRadius:  16,
        shadowOffset:  { width: 0, height: 6 },
        elevation:     6,
      }}
    >
      {loading ? (
        <ActivityIndicator size="small" color="#080808" />
      ) : (
        <>
          <Text
            className={`text-[17px] ${disabled ? 'text-ink-disabled' : 'text-surface-bg'}`}
            style={{ fontFamily: FONTS.spartan.bold }}
          >
            {label}
          </Text>
          <MaterialIcons name={icon} size={20} color={disabled ? '#555555' : '#080808'} />
        </>
      )}
    </TouchableOpacity>
  )
}

function MethodCard({
  icon,
  title,
  subtitle,
  onPress,
  loading,
  disabled,
}: {
  icon:      keyof typeof MaterialIcons.glyphMap
  title:     string
  subtitle:  string
  onPress:   () => void
  loading?:  boolean
  disabled?: boolean
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={loading || disabled}
      activeOpacity={0.8}
      className={`flex-row items-center gap-4 rounded-2xl border-[1.5px] p-4 min-h-[84px] mb-3 ${
        loading ? 'border-cyan bg-cyan-glow' : 'border-surface-border bg-surface-raised'
      }`}
      style={{ opacity: disabled && !loading ? 0.6 : 1 }}
    >
      <View className="w-12 h-12 rounded-2xl items-center justify-center bg-cyan-dim border border-cyan-border">
        <MaterialIcons name={icon} size={24} color={CYAN} />
      </View>
      <View className="flex-1">
        <Text className="text-[17px] text-ink-primary mb-0.5" style={{ fontFamily: FONTS.spartan.semiBold }}>
          {title}
        </Text>
        <Text className="text-[13px] leading-[18px] text-ink-muted">{subtitle}</Text>
      </View>
      {loading
        ? <ActivityIndicator size="small" color={CYAN} />
        : <MaterialIcons name="chevron-right" size={24} color="#818181" />
      }
    </TouchableOpacity>
  )
}

/** Soft cyan light behind the logo — the only decoration on the screen. */
function Backdrop() {
  return (
    <View className="absolute inset-0" pointerEvents="none">
      <Svg width="100%" height="100%">
        <Defs>
          <RadialGradient id="signInGlow" cx="50%" cy="8%" rx="85%" ry="45%">
            <Stop offset="0"   stopColor={CYAN} stopOpacity="0.16" />
            <Stop offset="0.6" stopColor={CYAN} stopOpacity="0.03" />
            <Stop offset="1"   stopColor={CYAN} stopOpacity="0" />
          </RadialGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#signInGlow)" />
      </Svg>
    </View>
  )
}

function useLockCountdown(
  lockState:     LockState,
  lockExpiresAt: React.MutableRefObject<number>,
  onUnlock:      () => void,
) {
  const [lockRemaining, setLockRemaining] = useState(0)

  useEffect(() => {
    if (lockState !== 'temporary') return
    const interval = setInterval(() => {
      const remaining = Math.max(0, Math.floor((lockExpiresAt.current - Date.now()) / 1000))
      setLockRemaining(remaining)
      if (remaining <= 0) onUnlock()
    }, 500)
    return () => clearInterval(interval)
  }, [lockState, lockExpiresAt, onUnlock])

  return lockRemaining
}

export default function SignInScreen() {
  const insets    = useSafeAreaInsets()
  const setUser   = useAuthStore(s => s.setUser)
  const setTokens = useAuthStore(s => s.setTokens)

  const [step,     setStep]     = useState<Step>('email')
  const [role,     setRole]     = useState<string | null>(null)
  const [method,   setMethod]   = useState<Method | null>(null)
  const [email,    setEmail]    = useState('')
  const [otp,      setOtp]      = useState('')
  const [password, setPassword] = useState('')
  const [showPass, setShowPass] = useState(false)
  const [focusedField, setFocusedField] = useState<'email' | 'password' | null>(null)
  const [loading,  setLoading]  = useState(false)
  // Whether to offer passkey sign-in at all. Computed once: it depends only on
  // the OS and the build, neither of which changes while the screen is open.
  const [passkeySupported] = useState(() => checkPasskeySupport().supported)
  const inFlight = useRef(false)
  const [error,    setError]    = useState<string | null>(null)

  const [lockState, setLockState] = useState<LockState>('none')
  const lockExpiresAt             = useRef<number>(0)

  const [resetState, setResetState] = useState<ResetState>('idle')

  const emailRef    = useRef<TextInput>(null)
  const otpRef      = useRef<TextInput>(null)
  const passwordRef = useRef<TextInput>(null)

  const handleUnlock = useCallback(() => {
    setLockState('none')
    setError(null)
    setOtp('')
    setPassword('')
    setTimeout(() => {
      if (step === 'otp')      otpRef.current?.focus()
      if (step === 'password') passwordRef.current?.focus()
    }, 100)
  }, [step])

  const lockRemaining = useLockCountdown(lockState, lockExpiresAt, handleUnlock)

  useEffect(() => {
    if (step === 'otp')      setTimeout(() => otpRef.current?.focus(), 400)
    if (step === 'password') setTimeout(() => passwordRef.current?.focus(), 400)
  }, [step])

  /**
   * Ask an administrator for a reset link.
   *
   * The API answers 200 with the same neutral message for every address, so a
   * success here proves nothing about whether the account exists — and the
   * confirmation copy is written not to claim otherwise. A failure is surfaced
   * (it is a real one: rate limited, or the server is unreachable) rather than
   * being dressed up as a success, which would leave someone waiting on an email
   * that was never going to arrive.
   */
  const handleRequestReset = useCallback(async () => {
    if (resetState !== 'idle') return
    setResetState('sending')
    setError(null)
    try {
      await requestPasswordReset(email)
      setResetState('sent')
    } catch (err: any) {
      setResetState('idle')
      setError(
        err?.response
          ? extractMessage(err, 'Could not submit your request. Please try again shortly.')
          : 'Could not reach the server. Check your connection and try again.',
      )
    }
  }, [email, resetState])

  const applyAuthStatus = useCallback(async (emailAddr: string) => {
    try {
      const status = await getAuthStatus(emailAddr)
      if (status.permanent) {
        setLockState('permanent')
      } else if (status.locked_until) {
        const expiry = new Date(status.locked_until).getTime()
        lockExpiresAt.current = expiry
        setLockState('temporary')
      }
    } catch {

    }
  }, [])

  const handleLockError = useCallback(async (message: string, emailAddr: string) => {
    const detected = classifyError(message)
    setLockState(detected)

    if (detected === 'temporary') {
      try {
        const status = await getAuthStatus(emailAddr)
        if (status.locked_until) {
          lockExpiresAt.current = new Date(status.locked_until).getTime()
        }
      } catch {
        lockExpiresAt.current = Date.now() + 3 * 60_000
      }
    }
  }, [])

  const handleEmailSubmit = useCallback(async () => {
    if (inFlight.current) return
    const trimmed = email.trim().toLowerCase()
    if (!trimmed || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setError('Enter a valid email address')
      return
    }
    setError(null)
    setLoading(true)
    inFlight.current = true
    try {
      const status = await getAuthStatus(trimmed)

      if (status.permanent) {
        setLockState('permanent')
        setEmail(trimmed)
        setRole(status.role)
        setStep(status.role === 'driver' ? 'method' : 'otp')
        return
      }

      if (status.locked_until) {
        lockExpiresAt.current = new Date(status.locked_until).getTime()
        setLockState('temporary')
        setEmail(trimmed)
        setRole(status.role)
        setStep(status.role === 'driver' ? 'method' : 'otp')
        return
      }

      setEmail(trimmed)
      setRole(status.role)
      setLockState('none')

      if (status.role === 'driver') {
        setStep('method')
      } else {
        await requestOtp(trimmed)
        setStep('otp')
      }
    } catch (err: any) {
      setError(extractMessage(err, 'Something went wrong. Try again.'))
    } finally {
      inFlight.current = false
      setLoading(false)
    }
  }, [email])

  const handleMethodSelect = async (chosen: Method) => {
    if (inFlight.current) return
    setMethod(chosen)
    setError(null)

    if (chosen === 'otp') {
      if (lockState !== 'none') {
        setStep('otp')
        return
      }
      setLoading(true)
      inFlight.current = true
      try {
        await requestOtp(email)
        setStep('otp')
      } catch (err: any) {
        setError(extractMessage(err, 'Failed to send OTP. Try again.'))
      } finally {
        inFlight.current = false
        setLoading(false)
      }
    } else {
      setStep('password')
    }
  }

  const handleOtpSubmit = useCallback(async (code: string) => {
    if (inFlight.current) return
    if (code.length !== 6 || lockState !== 'none') return
    setError(null)
    setLoading(true)
    inFlight.current = true
    let navigated = false
    try {
      const auth = await verifyOtp(email, code)
      setTokens(auth.accessToken, auth.refreshToken)
      // Only /auth/me carries the driver (or client) block the app routes on,
      // and verifyOtp has already put the tokens where the interceptor reads
      // them — so nothing is stored until the full user is in hand. Storing the
      // token response first used to persist a driver-less user, which stuck
      // around after a restart and had the driver's own screens telling them
      // they weren't logged in as a driver.
      const me = await getMe()
      setUser(me)
      if (me.must_change_password) {
        navigated = true
        router.replace('/change-password')
        return
      }
      const route = getMobileRoute(me.role)
      if (route === '/') {
        setError(`Role "${me.role}" has no mobile access.`)
        return
      }
      navigated = true
      router.replace(route as any)
    } catch (err: any) {
      const message = extractMessage(err, 'Invalid code. Try again.')
      setError(message)
      setOtp('')
      await handleLockError(message, email)
      if (classifyError(message) === 'none') {
        setTimeout(() => otpRef.current?.focus(), 100)
      }
    } finally {
      inFlight.current = false
      // keep the button disabled while the app navigates away
      if (!navigated) setLoading(false)
    }
  }, [email, lockState, setUser, setTokens, handleLockError])

  const handleOtpChange = (text: string) => {
    if (lockState !== 'none') return
    const digits = text.replace(/\D/g, '').slice(0, 6)
    setOtp(digits)
    setError(null)
    if (digits.length === 6) handleOtpSubmit(digits)
  }

  const handlePasswordSubmit = useCallback(async () => {
    if (inFlight.current) return
    if (lockState !== 'none') return
    if (!password.trim()) {
      setError('Enter your password')
      return
    }
    setError(null)
    setLoading(true)
    inFlight.current = true
    let navigated = false
    try {
      const auth = await loginWithPassword(email, password)
      setTokens(auth.accessToken, auth.refreshToken)
      // See the OTP path: the user is stored only once /auth/me has returned it
      // complete.
      const me = await getMe()
      setUser(me)
      if (me.must_change_password) {
        navigated = true
        router.replace('/change-password')
        return
      }
      const route = getMobileRoute(me.role)
      if (route === '/') {
        setError(`Role "${me.role}" has no mobile access.`)
        return
      }
      navigated = true
      router.replace(route as any)
    } catch (err: any) {
      const message = extractMessage(err, 'Incorrect password. Try again.')
      setError(message)
      await handleLockError(message, email)
    } finally {
      inFlight.current = false
      // keep the button disabled while the app navigates away
      if (!navigated) setLoading(false)
    }
  }, [email, password, lockState, setUser, setTokens, handleLockError])

  /**
   * Passkey sign-in.
   *
   * Deliberately outside the email → method → code state machine. A discoverable
   * credential means no email is ever typed: the OS shows its own account picker
   * and the server learns who is signing in only from the signed assertion. That
   * is also what removes the account-enumeration surface, so there is nothing
   * for the `method` chooser to choose between here.
   */
  const handlePasskeySignIn = useCallback(async () => {
    if (inFlight.current) return
    setError(null)
    setLoading(true)
    inFlight.current = true
    let navigated = false
    try {
      const options    = await passkeyAuthOptions()
      const assertion  = await getPasskey(options)
      const auth       = await passkeyAuthVerify(assertion)
      setTokens(auth.accessToken, auth.refreshToken)
      // Same reasoning as the OTP and password paths: only /auth/me carries the
      // driver block the app routes on, so nothing is stored until it is in hand.
      const me = await getMe()
      setUser(me)
      const route = getMobileRoute(me.role)
      if (route === '/') {
        setError(`Role "${me.role}" has no mobile access.`)
        return
      }
      navigated = true
      router.replace(route as any)
    } catch (err: any) {
      // Dismissing the OS prompt is not a failure and should not raise a banner —
      // WebAuthn deliberately reports "no credential" and "user said no"
      // identically, so a red error here would often be wrong as well as rude.
      if (err instanceof PasskeyCancelled) return
      setError(extractMessage(err, 'Could not sign you in with that passkey.'))
    } finally {
      inFlight.current = false
      if (!navigated) setLoading(false)
    }
  }, [setTokens, setUser])

  const handleBack = () => {
    setError(null)
    setOtp('')
    setPassword('')
    // A "request sent" confirmation belongs to one address. Stepping back could
    // lead to a different one, so clear it rather than let it follow along.
    setResetState('idle')
    if (step === 'method')   setStep('email')
    if (step === 'otp')      setStep(role === 'driver' ? 'method' : 'email')
    if (step === 'password') setStep('method')
  }

  /** From any later step, straight back to the email field. */
  const handleChangeEmail = () => {
    setError(null)
    setOtp('')
    setPassword('')
    setResetState('idle')
    setStep('email')
    setTimeout(() => emailRef.current?.focus(), 350)
  }

  const hasOtpError = !!error && step === 'otp'    && lockState === 'none'
  const isLocked    = lockState !== 'none'

  const stepTotal = role && role !== 'driver' ? 2 : 3
  const stepIndex =
    step === 'email'  ? 0 :
    step === 'method' ? 1 :
    step === 'otp'    ? (role === 'driver' ? 2 : 1) :
                        2

  const slide = (key: string, dir: 1 | -1 = 1) => ({
    key,
    from:       { opacity: 0, translateX: 16 * dir },
    animate:    { opacity: 1, translateX: 0 },
    exit:       { opacity: 0, translateX: -16 * dir },
    transition: { type: 'timing' as const, duration: 240 },
  })

  return (
    <View
      className="flex-1 bg-surface-bg"
      style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}
    >
      <Backdrop />

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 20}
      >
        <ScrollView
          contentContainerStyle={{ flexGrow: 1 }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          bounces={false}
        >
        <View className="flex-1 px-6 pb-6">

        {/* Top bar: back on the left, progress on the right. Fixed height so the
            logo never jumps when the back button appears. */}
        <View className="h-14 flex-row items-center justify-between">
          {step !== 'email' ? <BackButton onPress={handleBack} /> : <View className="w-11" />}
          <StepBar index={stepIndex} total={stepTotal} />
        </View>

        <MotiView
          from={{ opacity: 0, translateY: -12 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'timing', duration: 600 }}
          className="items-center mt-6"
        >
          <Image
            source={require('../assets/Final_Logo.png')}
            style={{ width: 232, height: undefined, aspectRatio: 3.92 }}
            resizeMode="contain"
            accessibilityLabel="8338 Logistics Services"
          />
          <View className="flex-row items-center gap-1.5 mt-5 rounded-full px-3 py-1.5 border border-cyan-border bg-cyan-glow">
            <MaterialIcons name="local-shipping" size={14} color={CYAN} />
            <Text className="text-[12px] tracking-[1.5px] text-cyan" style={{ fontFamily: FONTS.spartan.semiBold }}>
              DRIVER APP
            </Text>
          </View>
        </MotiView>

        {/* Pushes the form down into thumb reach on tall phones. */}
        <View className="flex-1 min-h-[32px]" />

        <MotiView
          from={{ opacity: 0, translateY: 24 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'timing', duration: 500, delay: 150 }}
        >
          <AnimatePresence exitBeforeEnter>

            {step === 'email' && (
              <MotiView {...slide('email', -1)}>
                <StepHeading
                  title="Sign in"
                  subtitle="Enter your work email to get started."
                />

                <FieldLabel>Email address</FieldLabel>
                <InputWrap hasError={!!error} focused={focusedField === 'email'}>
                  <MaterialIcons
                    name="mail-outline"
                    size={20}
                    color={focusedField === 'email' ? CYAN : MUTED}
                    style={{ marginRight: 12 }}
                  />
                  <TextInput
                    ref={emailRef}
                    value={email}
                    onChangeText={t => { setEmail(t); setError(null) }}
                    onFocus={() => setFocusedField('email')}
                    onBlur={() => setFocusedField(null)}
                    placeholder="you@company.com"
                    placeholderTextColor="#555555"
                    keyboardType="email-address"
                    autoCapitalize="none"
                    autoCorrect={false}
                    autoComplete="email"
                    returnKeyType="go"
                    onSubmitEditing={handleEmailSubmit}
                    className="flex-1 text-[16px] py-0 text-ink-primary"
                    selectionColor={CYAN}
                  />
                </InputWrap>

                {error && <ErrorRow message={error} />}

                <SubmitButton
                  label="Continue"
                  icon="arrow-forward"
                  onPress={handleEmailSubmit}
                  loading={loading}
                />

                {/*
                  Passkey sign-in, for drivers from outside vendors who have no
                  password at all. Shown only when this phone can actually use
                  one, so it is never a button that leads to a refusal. It skips
                  the email field entirely — the OS picks the account.
                */}
                {passkeySupported && (
                  <>
                    <View className="flex-row items-center my-5">
                      <View className="flex-1 h-px bg-white/10" />
                      <Text className="text-[12px] mx-3 text-ink-faint">or</Text>
                      <View className="flex-1 h-px bg-white/10" />
                    </View>

                    <Pressable
                      onPress={handlePasskeySignIn}
                      disabled={loading}
                      className="flex-row items-center justify-center h-[58px] rounded-2xl border-[1.5px] border-cyan-border bg-cyan-glow"
                      style={({ pressed }) => ({ opacity: loading ? 0.6 : pressed ? 0.8 : 1 })}
                    >
                      <MaterialIcons name="fingerprint" size={24} color={CYAN} style={{ marginRight: 10 }} />
                      <Text className="text-[16px] text-cyan" style={{ fontFamily: FONTS.spartan.semiBold }}>
                        Sign in with a passkey
                      </Text>
                    </Pressable>
                  </>
                )}
              </MotiView>
            )}

            {step === 'method' && (
              <MotiView {...slide('method')}>
                <StepHeading title="How do you want to sign in?" />
                <EmailChip email={email} onChange={handleChangeEmail} />

                <MethodCard
                  icon="mark-email-read"
                  title="Email me a code"
                  subtitle="We'll send a 6-digit code to your inbox"
                  onPress={() => handleMethodSelect('otp')}
                  loading={loading && method === 'otp'}
                  disabled={loading}
                />
                <MethodCard
                  icon="password"
                  title="Use my password"
                  subtitle="Sign in with your account password"
                  onPress={() => handleMethodSelect('password')}
                  disabled={loading}
                />

                {error && <ErrorRow message={error} />}
              </MotiView>
            )}

            {step === 'otp' && (
              <MotiView {...slide('otp')}>
                <StepHeading title="Enter your code" subtitle="We emailed a 6-digit code to" />
                <EmailChip email={email} onChange={handleChangeEmail} />

                <TextInput
                  ref={otpRef}
                  value={otp}
                  onChangeText={handleOtpChange}
                  keyboardType="number-pad"
                  maxLength={6}
                  className="absolute opacity-0 w-px h-px"
                  caretHidden
                  autoComplete="one-time-code"
                  editable={!isLocked}
                />

                <Pressable
                  onPress={() => {
                    if (isLocked) return
                    otpRef.current?.blur()
                    setTimeout(() => otpRef.current?.focus(), 50)
                  }}
                  className="flex-row justify-between gap-2"
                >
                  {[...Array(6)].map((_, i) => (
                    <OtpBox
                      key={i}
                      value={otp[i] ?? ''}
                      focused={otp.length === i && !loading && !isLocked}
                      hasError={hasOtpError}
                      locked={isLocked}
                    />
                  ))}
                </Pressable>

                {isLocked ? (
                  <LockBanner
                    lockState={lockState}
                    lockRemaining={lockRemaining}
                    role={role}
                    resetState={resetState}
                    onRequestReset={handleRequestReset}
                  />
                ) : (
                  error && <ErrorRow message={error} center />
                )}

                {loading && !isLocked && (
                  <MotiView
                    from={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="flex-row items-center justify-center gap-2 mt-5"
                  >
                    <ActivityIndicator size="small" color={CYAN} />
                    <Text className="text-[14px] text-cyan">Verifying…</Text>
                  </MotiView>
                )}

                <View className="items-center mt-4">
                  <ResendTimer email={email} disabled={isLocked} />
                </View>

                {otp.length === 6 && !loading && !isLocked && (
                  <SubmitButton
                    label="Verify code"
                    icon="check"
                    onPress={() => handleOtpSubmit(otp)}
                  />
                )}

                {isLocked && lockState !== 'permanent' && (
                  <SubmitButton
                    label="Locked"
                    icon="lock"
                    onPress={() => {}}
                    disabled
                  />
                )}
              </MotiView>
            )}

            {step === 'password' && (
              <MotiView {...slide('password')}>
                <StepHeading title="Enter your password" />
                <EmailChip email={email} onChange={handleChangeEmail} />

                <FieldLabel>Password</FieldLabel>
                <InputWrap hasError={!!error && !isLocked} focused={focusedField === 'password'}>
                  <MaterialIcons
                    name="lock-outline"
                    size={20}
                    color={focusedField === 'password' ? CYAN : MUTED}
                    style={{ marginRight: 12 }}
                  />
                  <TextInput
                    ref={passwordRef}
                    value={password}
                    onChangeText={t => { setPassword(t); setError(null) }}
                    onFocus={() => setFocusedField('password')}
                    onBlur={() => setFocusedField(null)}
                    placeholder="Your password"
                    placeholderTextColor="#555555"
                    secureTextEntry={!showPass}
                    autoCapitalize="none"
                    autoCorrect={false}
                    autoComplete="password"
                    returnKeyType="go"
                    onSubmitEditing={handlePasswordSubmit}
                    className="flex-1 text-[16px] py-0 text-ink-primary"
                    selectionColor={CYAN}
                    editable={!isLocked}
                  />
                  {!isLocked && (
                    <TouchableOpacity
                      onPress={() => setShowPass(v => !v)}
                      hitSlop={10}
                      className="p-1.5"
                      accessibilityLabel={showPass ? 'Hide password' : 'Show password'}
                    >
                      <MaterialIcons
                        name={showPass ? 'visibility-off' : 'visibility'}
                        size={22}
                        color={MUTED}
                      />
                    </TouchableOpacity>
                  )}
                </InputWrap>

                {isLocked ? (
                  <LockBanner
                    lockState={lockState}
                    lockRemaining={lockRemaining}
                    role={role}
                    resetState={resetState}
                    onRequestReset={handleRequestReset}
                  />
                ) : (
                  error && <ErrorRow message={error} />
                )}

                <SubmitButton
                  label={isLocked ? 'Locked' : 'Sign in'}
                  icon={isLocked ? 'lock' : 'arrow-forward'}
                  onPress={handlePasswordSubmit}
                  loading={loading}
                  disabled={isLocked}
                />

                {/* A locked account already shows the request button inside LockBanner. */}
                {lockState !== 'permanent' && (
                  resetState === 'sent' ? (
                    <View className="flex-row items-start gap-2 rounded-2xl px-4 py-3 mt-4 bg-surface-raised border border-surface-border">
                      <MaterialIcons name="mark-email-read" size={16} color={CYAN} style={{ marginTop: 2 }} />
                      <Text className="flex-1 text-[13px] leading-5 text-ink-secondary">
                        Your {approverLabel(role)} has been notified. Check your email for the reset link.
                      </Text>
                    </View>
                  ) : (
                    <TouchableOpacity
                      onPress={handleRequestReset}
                      disabled={resetState === 'sending'}
                      className="mt-3 py-3 items-center"
                    >
                      <Text className="text-[14px] text-cyan" style={{ fontFamily: FONTS.spartan.semiBold }}>
                        {resetState === 'sending' ? 'Requesting…' : 'Forgot password?'}
                      </Text>
                    </TouchableOpacity>
                  )
                )}
              </MotiView>
            )}

          </AnimatePresence>
        </MotiView>

        <MotiView
          from={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ type: 'timing', duration: 600, delay: 400 }}
          className="flex-row items-center justify-center gap-1.5 mt-8"
        >
          <MaterialIcons name="verified-user" size={13} color="#818181" />
          <Text className="text-[12px] text-ink-faint">
            8338 Logistics Services
          </Text>
        </MotiView>

        </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  )
}
