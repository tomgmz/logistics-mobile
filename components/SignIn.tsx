import React, { useCallback, useEffect, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Animated,
  Easing,
  KeyboardAvoidingView,
  Platform,
  Pressable,
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
  loginWithPassword,
  requestOtp,
  verifyOtp,
} from '../lib/api/auth.api'
import { useAuthStore } from '../lib/store/auth.store'

const MOBILE_ROLE_ROUTES: Record<string, string> = {
  super_admin: '/superadmin',
  driver:      '/driver',
}

function getMobileRoute(role: string): string {
  return MOBILE_ROLE_ROUTES[role] ?? '/'
}

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
        'flex-1 h-14 rounded-xl items-center justify-center border-[1.5px]',
        locked    ? 'border-orange-400/40  bg-orange-400/5'   :
        hasError  ? 'border-error          bg-error-dim'      :
        focused   ? 'border-cyan           bg-cyan-glow'      :
        value     ? 'border-cyan-border    bg-cyan-dim'       :
                    'border-surface-border bg-surface-raised',
      ].join(' ')}
    >
      {value ? (
        <Text
          className={`text-[22px] font-bold ${
            locked ? 'text-orange-400/60' : hasError ? 'text-error' : 'text-ink-primary'
          }`}
        >
          {value}
        </Text>
      ) : focused && !locked ? (
        <Animated.View
          className="w-0.5 h-6 rounded-sm bg-cyan"
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
      <Text className="text-[13px] text-ink-muted">
        Resend code in <Text className="text-cyan">{seconds}s</Text>
      </Text>
    )
  }

  return (
    <TouchableOpacity onPress={handleResend} disabled={resending}>
      <Text className="text-[13px] text-cyan">
        {resending ? 'Sending…' : 'Resend code'}
      </Text>
    </TouchableOpacity>
  )
}

function LockBanner({
  lockState,
  lockRemaining,
}: {
  lockState:     LockState
  lockRemaining: number
}) {
  if (lockState === 'none') return null

  if (lockState === 'permanent') {
    return (
      <MotiView
        from={{ opacity: 0, translateY: -4 }}
        animate={{ opacity: 1, translateY: 0 }}
        className="rounded-xl px-4 py-3 mt-3"
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
        <Text className="text-[12px] leading-5" style={{ color: 'rgba(239,68,68,0.75)' }}>
          Too many failed attempts. Contact your administrator to regain access.
        </Text>
      </MotiView>
    )
  }

  return (
    <MotiView
      from={{ opacity: 0, translateY: -4 }}
      animate={{ opacity: 1, translateY: 0 }}
      className="rounded-xl px-4 py-3 mt-3 flex-row items-center justify-between gap-4"
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

function BackRow({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <TouchableOpacity onPress={onPress} className="flex-row items-center gap-1 mb-3.5">
      <MaterialIcons name="arrow-back" size={14} color="#4df9ed" />
      <Text className="text-xs text-cyan">{label}</Text>
    </TouchableOpacity>
  )
}

function ErrorRow({ message, center }: { message: string; center?: boolean }) {
  return (
    <MotiView
      from={{ opacity: 0, translateY: -4 }}
      animate={{ opacity: 1, translateY: 0 }}
      className={`flex-row items-center gap-1.5 mt-1.5 mb-0.5 ${center ? 'justify-center mt-3' : ''}`}
    >
      <MaterialIcons name="error-outline" size={13} color="#ff4d4d" />
      <Text className="text-xs text-error flex-1">{message}</Text>
    </MotiView>
  )
}

function InputWrap({ hasError, children }: { hasError: boolean; children: React.ReactNode }) {
  return (
    <View
      className={[
        'flex-row items-center rounded-xl border px-3.5 h-[52px] mb-1',
        hasError
          ? 'border-error bg-error-dim'
          : 'border-surface-border bg-surface-raised',
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
      className={`flex-row items-center justify-center gap-2 bg-cyan rounded-xl h-[52px] mt-5 ${
        loading || disabled ? 'opacity-60' : 'opacity-100'
      }`}
    >
      {loading ? (
        <ActivityIndicator size="small" color="#080808" />
      ) : (
        <>
          <Text className="text-[15px] font-extrabold tracking-wide text-surface-bg">
            {label}
          </Text>
          <MaterialIcons name={icon} size={16} color="#080808" />
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
      className="flex-row items-center gap-4 rounded-xl border border-surface-border bg-surface-raised p-4 mb-3"
    >
      <View className="w-10 h-10 rounded-xl items-center justify-center bg-cyan-dim">
        <MaterialIcons name={icon} size={20} color="#4df9ed" />
      </View>
      <View className="flex-1">
        <Text className="text-[15px] font-semibold text-ink-primary mb-0.5">{title}</Text>
        <Text className="text-[12px] text-ink-muted">{subtitle}</Text>
      </View>
      {loading
        ? <ActivityIndicator size="small" color="#4df9ed" />
        : <MaterialIcons name="chevron-right" size={20} color="#818181" />
      }
    </TouchableOpacity>
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
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState<string | null>(null)

  const [lockState, setLockState] = useState<LockState>('none')
  const lockExpiresAt             = useRef<number>(0)

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
    const trimmed = email.trim().toLowerCase()
    if (!trimmed || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setError('Enter a valid email address')
      return
    }
    setError(null)
    setLoading(true)
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
      setLoading(false)
    }
  }, [email])

  const handleMethodSelect = async (chosen: Method) => {
    setMethod(chosen)
    setError(null)

    if (chosen === 'otp') {
      if (lockState !== 'none') {
        setStep('otp')
        return
      }
      setLoading(true)
      try {
        await requestOtp(email)
        setStep('otp')
      } catch (err: any) {
        setError(extractMessage(err, 'Failed to send OTP. Try again.'))
      } finally {
        setLoading(false)
      }
    } else {
      setStep('password')
    }
  }

  const handleOtpSubmit = useCallback(async (code: string) => {
    if (code.length !== 6 || lockState !== 'none') return
    setError(null)
    setLoading(true)
    try {
      const auth = await verifyOtp(email, code)
      setTokens(auth.accessToken, auth.refreshToken)
      setUser(auth.user)
      const me = await getMe()
      setUser(me)
      if (me.must_change_password) {
        router.replace('/change-password')
        return
      }
      const route = getMobileRoute(me.role)
      if (route === '/') {
        setError(`Role "${me.role}" has no mobile access.`)
        return
      }
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
      setLoading(false)
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
    if (lockState !== 'none') return
    if (!password.trim()) {
      setError('Enter your password')
      return
    }
    setError(null)
    setLoading(true)
    try {
      const auth = await loginWithPassword(email, password)
      setTokens(auth.accessToken, auth.refreshToken)
      setUser(auth.user)
      const me = await getMe()
      setUser(me)
      if (me.must_change_password) {
        router.replace('/change-password')
        return
      }
      const route = getMobileRoute(me.role)
      if (route === '/') {
        setError(`Role "${me.role}" has no mobile access.`)
        return
      }
      router.replace(route as any)
    } catch (err: any) {
      const message = extractMessage(err, 'Incorrect password. Try again.')
      setError(message)
      await handleLockError(message, email)
    } finally {
      setLoading(false)
    }
  }, [email, password, lockState, setUser, setTokens, handleLockError])

  const handleBack = () => {
    setError(null)
    setOtp('')
    setPassword('')
    if (step === 'method')   setStep('email')
    if (step === 'otp')      setStep(role === 'driver' ? 'method' : 'email')
    if (step === 'password') setStep('method')
  }

  const hasOtpError = !!error && step === 'otp'    && lockState === 'none'
  const isLocked    = lockState !== 'none'

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-surface-bg"
      style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View className="absolute inset-0" pointerEvents="none">
        {[...Array(8)].map((_, i) => (
          <View
            key={i}
            className="absolute left-0 right-0 h-px bg-white/[0.025]"
            style={{ top: `${(i + 1) * 12}%` as any }}
          />
        ))}
      </View>

      <View className="absolute top-0 left-0 w-[120px] h-[120px] border-t border-l border-cyan-accent" pointerEvents="none" />
      <View className="absolute bottom-0 right-0 w-[120px] h-[120px] border-b border-r border-cyan-accent" pointerEvents="none" />

      <View className="flex-1 justify-center px-6">

        <MotiView
          from={{ opacity: 0, translateY: -16 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'timing', duration: 600 }}
          className="items-center mb-9"
        >
          <View className="w-12 h-12 rounded-[14px] items-center justify-center mb-3.5 border border-cyan-border bg-cyan-dim">
            <View className="w-5 h-5 rounded-[5px] opacity-90 bg-cyan" />
          </View>
          <Text className="text-[17px] font-extrabold tracking-[4px] mb-1 text-ink-primary">
            8338 LOGISTICS
          </Text>
          <Text className="text-[11px] tracking-[2px] uppercase text-ink-muted">
            Fleet · Routes · Delivery
          </Text>
        </MotiView>

        <MotiView
          from={{ opacity: 0, translateY: 24 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'timing', duration: 500, delay: 150 }}
          className="rounded-[20px] border border-surface-border bg-surface-card overflow-hidden p-6 pt-0"
        >
          <View className="h-0.5 -mx-px mb-6 opacity-70 bg-cyan" />

          <AnimatePresence exitBeforeEnter>

            {step === 'email' && (
              <MotiView
                key="email"
                from={{ opacity: 0, translateX: -12 }}
                animate={{ opacity: 1, translateX: 0 }}
                exit={{ opacity: 0, translateX: 12 }}
                transition={{ type: 'timing', duration: 250 }}
              >
                <Text className="text-[22px] font-bold tracking-tight mb-1.5 text-ink-primary">
                  Sign In
                </Text>
                <Text className="text-[13px] leading-5 mb-6 text-ink-muted">
                  Enter your email to continue
                </Text>

                <Text className="text-[11px] font-semibold tracking-[1px] uppercase mb-2 text-ink-muted">
                  Email address
                </Text>
                <InputWrap hasError={!!error}>
                  <MaterialIcons name="mail-outline" size={16} color="#999999" style={{ marginRight: 10 }} />
                  <TextInput
                    ref={emailRef}
                    value={email}
                    onChangeText={t => { setEmail(t); setError(null) }}
                    placeholder="you@company.com"
                    placeholderTextColor="#555555"
                    keyboardType="email-address"
                    autoCapitalize="none"
                    autoCorrect={false}
                    autoComplete="email"
                    returnKeyType="go"
                    onSubmitEditing={handleEmailSubmit}
                    className="flex-1 text-[15px] py-0 text-ink-primary"
                    selectionColor="#4df9ed"
                  />
                </InputWrap>

                {error && <ErrorRow message={error} />}

                <SubmitButton
                  label="Continue"
                  icon="arrow-forward"
                  onPress={handleEmailSubmit}
                  loading={loading}
                />
              </MotiView>
            )}

            {step === 'method' && (
              <MotiView
                key="method"
                from={{ opacity: 0, translateX: 12 }}
                animate={{ opacity: 1, translateX: 0 }}
                exit={{ opacity: 0, translateX: -12 }}
                transition={{ type: 'timing', duration: 250 }}
              >
                <BackRow label="Change email" onPress={handleBack} />
                <Text className="text-[22px] font-bold tracking-tight mb-1.5 text-ink-primary">
                  How to sign in?
                </Text>
                <Text className="text-[13px] leading-5 mb-6 text-ink-muted">
                  Choose your preferred sign in method for{'\n'}
                  <Text className="text-cyan">{email}</Text>
                </Text>

                <MethodCard
                  icon="mail-outline"
                  title="Email OTP"
                  subtitle="We'll send a 6-digit code to your email"
                  onPress={() => handleMethodSelect('otp')}
                  loading={loading && method === 'otp'}
                  disabled={loading}
                />
                <MethodCard
                  icon="lock-outline"
                  title="Password"
                  subtitle="Sign in with your account password"
                  onPress={() => handleMethodSelect('password')}
                  disabled={loading}
                />

                {error && <ErrorRow message={error} />}
              </MotiView>
            )}

            {step === 'otp' && (
              <MotiView
                key="otp"
                from={{ opacity: 0, translateX: 12 }}
                animate={{ opacity: 1, translateX: 0 }}
                exit={{ opacity: 0, translateX: -12 }}
                transition={{ type: 'timing', duration: 250 }}
              >
                <BackRow
                  label={role === 'driver' ? 'Change method' : 'Change email'}
                  onPress={handleBack}
                />
                <Text className="text-[22px] font-bold tracking-tight mb-1.5 text-ink-primary">
                  Check your email
                </Text>
                <Text className="text-[13px] leading-5 mb-7 text-ink-muted">
                  We sent a 6-digit code to{'\n'}
                  <Text className="text-cyan">{email}</Text>
                </Text>

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
                  <LockBanner lockState={lockState} lockRemaining={lockRemaining} />
                ) : (
                  error && <ErrorRow message={error} center />
                )}

                {loading && !isLocked && (
                  <MotiView
                    from={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="flex-row items-center justify-center gap-2 mt-4"
                  >
                    <ActivityIndicator size="small" color="#4df9ed" />
                    <Text className="text-[13px] text-cyan">Verifying…</Text>
                  </MotiView>
                )}

                <View className="items-center mt-5">
                  <ResendTimer email={email} disabled={isLocked} />
                </View>

                {otp.length === 6 && !loading && !isLocked && (
                  <SubmitButton
                    label="Verify Code"
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
              <MotiView
                key="password"
                from={{ opacity: 0, translateX: 12 }}
                animate={{ opacity: 1, translateX: 0 }}
                exit={{ opacity: 0, translateX: -12 }}
                transition={{ type: 'timing', duration: 250 }}
              >
                <BackRow label="Change method" onPress={handleBack} />
                <Text className="text-[22px] font-bold tracking-tight mb-1.5 text-ink-primary">
                  Enter password
                </Text>
                <Text className="text-[13px] leading-5 mb-6 text-ink-muted">
                  Signing in as <Text className="text-cyan">{email}</Text>
                </Text>

                <Text className="text-[11px] font-semibold tracking-[1px] uppercase mb-2 text-ink-muted">
                  Password
                </Text>
                <InputWrap hasError={!!error && !isLocked}>
                  <MaterialIcons name="lock-outline" size={16} color="#999999" style={{ marginRight: 10 }} />
                  <TextInput
                    ref={passwordRef}
                    value={password}
                    onChangeText={t => { setPassword(t); setError(null) }}
                    placeholder="Your password"
                    placeholderTextColor="#555555"
                    secureTextEntry={!showPass}
                    autoCapitalize="none"
                    autoCorrect={false}
                    autoComplete="password"
                    returnKeyType="go"
                    onSubmitEditing={handlePasswordSubmit}
                    className="flex-1 text-[15px] py-0 text-ink-primary"
                    selectionColor="#4df9ed"
                    editable={!isLocked}
                  />
                  {!isLocked && (
                    <TouchableOpacity onPress={() => setShowPass(v => !v)} className="p-1">
                      <MaterialIcons
                        name={showPass ? 'visibility-off' : 'visibility'}
                        size={18}
                        color="#999999"
                      />
                    </TouchableOpacity>
                  )}
                </InputWrap>

                {isLocked ? (
                  <LockBanner lockState={lockState} lockRemaining={lockRemaining} />
                ) : (
                  error && <ErrorRow message={error} />
                )}

                <SubmitButton
                  label={isLocked ? 'Locked' : 'Sign In'}
                  icon={isLocked ? 'lock' : 'arrow-forward'}
                  onPress={handlePasswordSubmit}
                  loading={loading}
                  disabled={isLocked}
                />
              </MotiView>
            )}

          </AnimatePresence>
        </MotiView>

        <MotiView
          from={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ type: 'timing', duration: 600, delay: 400 }}
          className="flex-row items-center justify-center gap-2.5 mt-8"
        >
          <View className="w-[3px] h-[3px] rounded-sm bg-ink-faint" />
          <Text className="text-[11px] tracking-[1.5px] uppercase text-ink-faint">
            {step === 'password' ? 'Secure · Password Auth' : 'Secure · Password · OTP'}
          </Text>
          <View className="w-[3px] h-[3px] rounded-sm bg-ink-faint" />
        </MotiView>

      </View>
    </KeyboardAvoidingView>
  )
}