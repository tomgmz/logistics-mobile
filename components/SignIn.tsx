import React, { useCallback, useEffect, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Animated,
  Easing,
  Image,
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
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller'
import Svg, { Circle, Defs, G, LinearGradient, Path, Rect, Stop } from 'react-native-svg'

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
import { ConfirmDialog } from './ui/ConfirmDialog'

const CYAN  = '#4df9ed'
const MUTED = '#818181'

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
        'flex-1 h-[52px] rounded-xl items-center justify-center border-[1.5px]',
        locked    ? 'border-orange-400/40  bg-orange-400/5'   :
        hasError  ? 'border-[#f62626] bg-[rgba(246,38,38,0.10)]'      :
        focused   ? 'border-cyan           bg-cyan-glow'      :
        value     ? 'border-cyan-border    bg-cyan-dim'       :
                    'border-[#424242] bg-[#1b1b1b]',
      ].join(' ')}
    >
      {value ? (
        <Text
          className={`text-[22px] ${
            locked ? 'text-orange-400/60' : hasError ? 'text-[#f62626]' : 'text-ink-primary'
          }`}
          style={{ fontFamily: FONTS.spartan.bold }}
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
      <Text className="text-[13px] text-ink-faint">
        Resend code in <Text className="text-cyan" style={{ fontVariant: ['tabular-nums'] }}>{seconds}s</Text>
      </Text>
    )
  }

  return (
    <TouchableOpacity onPress={handleResend} disabled={resending} className="flex-row items-center gap-1.5 py-2 px-3">
      <MaterialIcons name="refresh" size={15} color={CYAN} />
      <Text className="text-[13px] text-cyan" style={{ fontFamily: FONTS.spartan.semiBold }}>
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
      className="w-9 h-9 rounded-full items-center justify-center border border-[#424242] bg-[#1b1b1b]"
    >
      <MaterialIcons name="arrow-back" size={18} color="#ffffff" />
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
          className={`h-1 rounded-full ${
            i === index ? 'w-6 bg-cyan' : i < index ? 'w-3 bg-cyan-border' : 'w-3 bg-[#424242]'
          }`}
        />
      ))}
    </View>
  )
}

/** The address being signed in as, with a one-tap way to use a different one. */
function EmailChip({ email, onChange }: { email: string; onChange: () => void }) {
  return (
    <View className="flex-row items-center gap-3 rounded-full border border-[#424242] bg-[#1b1b1b] pl-1 pr-1 py-1 mb-5">
      <View className="w-7 h-7 rounded-full items-center justify-center bg-cyan-dim border border-cyan-border">
        <Text className="text-[13px] text-cyan" style={{ fontFamily: FONTS.spartan.bold }}>
          {email.charAt(0).toUpperCase()}
        </Text>
      </View>
      <Text numberOfLines={1} className="flex-1 text-[13px] text-ink-secondary">
        {email}
      </Text>
      <TouchableOpacity onPress={onChange} hitSlop={6} className="rounded-full px-3 py-1.5 bg-black border border-[#424242]">
        <Text className="text-[12px] text-cyan" style={{ fontFamily: FONTS.spartan.semiBold }}>Change</Text>
      </TouchableOpacity>
    </View>
  )
}

function StepHeading({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <>
      <Text className="text-[24px] leading-[30px] mb-1 text-center text-ink-primary" style={{ fontFamily: FONTS.spartan.bold }}>
        {title}
      </Text>
      {subtitle ? (
        <Text className="text-[14px] leading-[20px] mb-5 text-center text-ink-faint">{subtitle}</Text>
      ) : (
        <View className="h-3" />
      )}
    </>
  )
}

function FieldLabel({ children }: { children: string }) {
  return (
    <Text className="text-[12px] mb-1.5 ml-4 text-ink-secondary" style={{ fontFamily: FONTS.spartan.semiBold }}>
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
      <MaterialIcons name="error-outline" size={14} color="#f62626" />
      <Text className={`text-[12px] text-[#f62626] ${center ? '' : 'flex-1'}`}>{message}</Text>
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
        'flex-row items-center rounded-full border px-4 h-12 mb-1',
        hasError ? 'border-[#f62626] bg-[rgba(246,38,38,0.10)]'           :
        focused  ? 'border-cyan bg-cyan-glow'            :
                   'border-[#424242] bg-[#1b1b1b]',
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
      className={`flex-row items-center justify-center gap-2 rounded-full h-12 mt-5 ${
        disabled ? 'bg-[#1b1b1b] border border-[#424242]' : 'bg-cyan'
      } ${loading ? 'opacity-70' : 'opacity-100'}`}
      style={disabled ? undefined : {
        shadowColor:   CYAN,
        shadowOpacity: 0.25,
        shadowRadius:  10,
        shadowOffset:  { width: 0, height: 4 },
        elevation:     4,
      }}
    >
      {loading ? (
        <ActivityIndicator size="small" color="#080808" />
      ) : (
        <>
          <Text
            className={`text-[15px] ${disabled ? 'text-ink-faint' : 'text-black'}`}
            style={{ fontFamily: FONTS.spartan.bold }}
          >
            {label}
          </Text>
          <MaterialIcons name={icon} size={18} color={disabled ? '#555555' : '#080808'} />
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
      className={`flex-row items-center gap-3 rounded-2xl border px-3.5 py-3 mb-2.5 ${
        loading ? 'border-cyan bg-cyan-glow' : 'border-[#424242] bg-[#1b1b1b]'
      }`}
      style={{ opacity: disabled && !loading ? 0.6 : 1 }}
    >
      <View className="w-10 h-10 rounded-xl items-center justify-center bg-cyan-dim border border-cyan-border">
        <MaterialIcons name={icon} size={20} color={CYAN} />
      </View>
      <View className="flex-1">
        <Text className="text-[15px] text-ink-primary mb-0.5" style={{ fontFamily: FONTS.spartan.semiBold }}>
          {title}
        </Text>
        <Text className="text-[12px] leading-[16px] text-ink-faint">{subtitle}</Text>
      </View>
      {loading
        ? <ActivityIndicator size="small" color={CYAN} />
        : <MaterialIcons name="chevron-right" size={20} color="#818181" />
      }
    </TouchableOpacity>
  )
}

/**
 * The same backdrop as the driver home's "Check your routes" card: the route
 * map at half strength over black. Shaded darker at the top for the logo and
 * headline, and faded to black at the foot so it runs into the sheet.
 */
function HeroBackdrop() {
  return (
    <View className="absolute inset-0 bg-black overflow-hidden" pointerEvents="none">
      <Image
        source={require('../assets/home/route-map.png')}
        resizeMode="cover"
        className="absolute inset-0 h-full w-full opacity-50"
      />
      <Svg width="100%" height="100%" style={{ position: 'absolute' }}>
        <Defs>
          <LinearGradient id="heroShade" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0"    stopColor="#000000" stopOpacity="0.75" />
            <Stop offset="0.45" stopColor="#000000" stopOpacity="0.35" />
            <Stop offset="0.8"  stopColor="#000000" stopOpacity="0.6" />
            <Stop offset="1"    stopColor="#000000" stopOpacity="1" />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#heroShade)" />
      </Svg>
    </View>
  )
}

// MaterialIcons "local-shipping", inlined so it can sit inside the SVG scene.
const TRUCK_PATH =
  'M20 8h-3V4H3c-1.1 0-2 .9-2 2v11h2c0 1.66 1.34 3 3 3s3-1.34 3-3h6c0 1.66 1.34 3 3 3s3-1.34 3-3h2v-5l-3-4z' +
  'M6 18.5c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5z' +
  'm13.5-9l1.96 2.5H17V9.5h2.5zm-1.5 9c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5z'

/** A route from pickup to drop-off with the truck midway, drawn over the map. */
function HeroArt() {
  return (
    <Svg width="100%" height={104} viewBox="0 0 360 150" preserveAspectRatio="xMidYMid slice">
      {/* The road: a soft wide glow under a dashed line. */}
      <Path d="M24 128 C 90 128, 90 82, 160 82 S 250 40, 330 30" stroke={CYAN} strokeOpacity={0.12} strokeWidth={14} strokeLinecap="round" fill="none" />
      <Path d="M24 128 C 90 128, 90 82, 160 82 S 250 40, 330 30" stroke={CYAN} strokeOpacity={0.85} strokeWidth={3} strokeDasharray="1 9" strokeLinecap="round" fill="none" />

      {/* Pickup, a stop, and the drop-off. */}
      <Circle cx={24}  cy={128} r={9}  fill="#000000" stroke={CYAN} strokeWidth={3} />
      <Circle cx={160} cy={82}  r={6}  fill={CYAN} fillOpacity={0.9} />
      <Circle cx={330} cy={30}  r={16} fill={CYAN} fillOpacity={0.15} />
      <Circle cx={330} cy={30}  r={8}  fill={CYAN} />

      {/* The truck, on the road between the stop and the drop-off. */}
      <Circle cx={238} cy={58} r={22} fill={CYAN} />
      <Circle cx={238} cy={58} r={29} fill="none" stroke={CYAN} strokeOpacity={0.3} strokeWidth={2} />
      <G transform="translate(223.6 43.6) scale(1.2)">
        <Path d={TRUCK_PATH} fill="#000000" />
      </G>
    </Svg>
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
  // "Forgot password?" asks first: it pages an administrator, so a stray tap
  // should not send the request.
  const [confirmReset, setConfirmReset] = useState(false)

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
    // Navy behind the status bar so the hero runs edge to edge; the sheet below
    // carries its own bottom inset.
    <View className="flex-1 bg-black">
      {/*
        Lifts the screen while the keyboard is up so the focused field — and the
        button under it, hence the offset — sit just above the keyboard, then
        scrolls back to where it was once the keyboard hides. KeyboardAvoidingView
        could not do this reliably: Android is edge-to-edge since Expo 54, so the
        window no longer resizes for the keyboard.
      */}
      <KeyboardAwareScrollView
        bottomOffset={96}
        contentContainerStyle={{ flexGrow: 1 }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        bounces={false}
      >

        {/* ── Hero ─────────────────────────────────────────────────────── */}
        <View style={{ paddingTop: insets.top }}>
          <HeroBackdrop />

          <MotiView
            from={{ opacity: 0, translateY: -12 }}
            animate={{ opacity: 1, translateY: 0 }}
            transition={{ type: 'timing', duration: 600 }}
            className="px-5 pt-3"
          >
            <View className="flex-row items-center justify-between">
              <Image
                source={require('../assets/Final_Logo.png')}
                style={{ width: 108, height: undefined, aspectRatio: 3.92 }}
                resizeMode="contain"
                accessibilityLabel="8338 Logistics Services"
              />
              <View className="flex-row items-center gap-1 rounded-full px-2.5 py-1 border border-cyan-border bg-cyan-glow">
                <MaterialIcons name="local-shipping" size={12} color={CYAN} />
                <Text className="text-[10px] tracking-[1.2px] text-cyan" style={{ fontFamily: FONTS.spartan.semiBold }}>
                  DRIVER APP
                </Text>
              </View>
            </View>

            <Text
              className="text-[24px] leading-[30px] mt-5 text-ink-primary"
              style={{ fontFamily: FONTS.spartan.bold }}
            >
              Sign in to keep{'\n'}
              <Text className="text-cyan">every delivery</Text>{'\n'}
              on track.
            </Text>
          </MotiView>

          <MotiView
            from={{ opacity: 0, translateX: -24 }}
            animate={{ opacity: 1, translateX: 0 }}
            transition={{ type: 'timing', duration: 700, delay: 200 }}
            className="mt-1 pb-8"
          >
            <HeroArt />
          </MotiView>
        </View>

        {/* ── Sheet ────────────────────────────────────────────────────── */}
        <MotiView
          from={{ opacity: 0, translateY: 40 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'timing', duration: 500, delay: 150 }}
          className="flex-1 -mt-6 rounded-t-[28px] bg-[#0e1010] border-t-[0.5px] border-[#424242] px-5 pt-4"
          style={{ paddingBottom: Math.max(insets.bottom, 16) + 8 }}
        >
          {/* Back on the left, progress on the right. Fixed height so the title
              never jumps when the back button appears. */}
          <View className="h-9 flex-row items-center justify-between mb-2">
            {step !== 'email' ? <BackButton onPress={handleBack} /> : <View className="w-9" />}
            <StepBar index={stepIndex} total={stepTotal} />
          </View>

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
                    size={18}
                    color={focusedField === 'email' ? CYAN : MUTED}
                    style={{ marginRight: 10 }}
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
                    className="flex-1 text-[15px] py-0 text-ink-primary"
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
                      <View className="flex-1 h-px bg-[#424242]" />
                      <Text className="text-[12px] mx-3 text-ink-faint">Or continue with</Text>
                      <View className="flex-1 h-px bg-[#424242]" />
                    </View>

                    <Pressable
                      onPress={handlePasskeySignIn}
                      disabled={loading}
                      className="flex-row items-center justify-center h-12 rounded-full border border-cyan-border bg-black"
                      style={({ pressed }) => ({ opacity: loading ? 0.6 : pressed ? 0.8 : 1 })}
                    >
                      <MaterialIcons name="fingerprint" size={20} color={CYAN} style={{ marginRight: 8 }} />
                      <Text className="text-[15px] text-cyan" style={{ fontFamily: FONTS.spartan.semiBold }}>
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
                    <Text className="text-[13px] text-cyan">Verifying…</Text>
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
                    size={18}
                    color={focusedField === 'password' ? CYAN : MUTED}
                    style={{ marginRight: 10 }}
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
                    className="flex-1 text-[15px] py-0 text-ink-primary"
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
                        size={19}
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
                    <View className="flex-row items-start gap-2 rounded-2xl px-4 py-3 mt-4 bg-[#1b1b1b] border border-[#424242]">
                      <MaterialIcons name="mark-email-read" size={16} color={CYAN} style={{ marginTop: 2 }} />
                      <Text className="flex-1 text-[13px] leading-5 text-ink-secondary">
                        Your {approverLabel(role)} has been notified. Check your email for the reset link.
                      </Text>
                    </View>
                  ) : (
                    <TouchableOpacity
                      onPress={() => setConfirmReset(true)}
                      disabled={resetState === 'sending'}
                      className="mt-2 py-2.5 items-center"
                    >
                      <Text className="text-[13px] text-cyan" style={{ fontFamily: FONTS.spartan.semiBold }}>
                        {resetState === 'sending' ? 'Requesting…' : 'Forgot password?'}
                      </Text>
                    </TouchableOpacity>
                  )
                )}
              </MotiView>
            )}

          </AnimatePresence>

          {/* Pins the footer to the bottom of the sheet on tall phones. */}
          <View className="flex-1 min-h-[20px]" />

          <View className="flex-row items-center justify-center gap-1.5">
            <MaterialIcons name="verified-user" size={13} color="#818181" />
            <Text className="text-[12px] text-ink-faint">
              8338 Logistics Services
            </Text>
          </View>
        </MotiView>

      </KeyboardAwareScrollView>

      <ConfirmDialog
        visible={confirmReset}
        title="Reset your password?"
        message={`We'll ask your ${approverLabel(role)} to email a password reset link to ${email}.`}
        confirmLabel="Send request"
        busy={resetState === 'sending'}
        onConfirm={async () => {
          // handleRequestReset reports its own failure under the field, so the
          // dialog just closes either way once the request has settled.
          await handleRequestReset()
          setConfirmReset(false)
        }}
        onCancel={() => setConfirmReset(false)}
      />
    </View>
  )
}
