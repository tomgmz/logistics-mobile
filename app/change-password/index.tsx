import { useCallback, useEffect, useState } from 'react'
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native'
import { router } from 'expo-router'
import { useAuthStore, useAuthHydrated } from '../../lib/store/auth.store'
import { changePassword, getMe } from '../../lib/api/auth.api'

const CYAN = '#4DF9ED'
const BG_MAIN = '#0a0a0a'
const BG_CARD = 'rgba(20,20,20,0.85)'
const ERROR = '#f87171'
const MUTED = 'rgba(255,255,255,0.35)'

const ROLE_ROUTES: Record<string, string> = {
  admin: '/admin',
  driver: '/driver',
}

function getMobileRoute(role: string): string {
  return ROLE_ROUTES[role] ?? '/sign-in'
}

interface Requirement {
  label: string
  test: (v: string) => boolean
}

const REQUIREMENTS: Requirement[] = [
  { label: 'At least 8 characters', test: v => v.length >= 8 },
  { label: 'One uppercase letter (A–Z)', test: v => /[A-Z]/.test(v) },
  { label: 'One lowercase letter (a–z)', test: v => /[a-z]/.test(v) },
  { label: 'One number (0–9)', test: v => /\d/.test(v) },
  { label: 'One special character (!@#…)', test: v => /[^A-Za-z0-9]/.test(v) },
]

function getStrength(password: string): number {
  return REQUIREMENTS.filter(r => r.test(password)).length
}

const STRENGTH_COLORS = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#4df9ed']
const STRENGTH_LABELS = ['', 'Weak', 'Fair', 'Good', 'Strong', 'Excellent']

function StrengthBar({ strength }: { strength: number }) {
  if (strength === 0) return null
  const color = STRENGTH_COLORS[strength - 1]
  const label = STRENGTH_LABELS[strength]

  return (
    <View style={{ gap: 4, marginTop: 4 }}>
      <View style={{ flexDirection: 'row', gap: 4 }}>
        {Array.from({ length: 5 }).map((_, i) => (
          <View
            key={i}
            style={{
              flex: 1,
              height: 3,
              borderRadius: 99,
              backgroundColor: i < strength ? color : 'rgba(255,255,255,0.1)',
            }}
          />
        ))}
      </View>
      <Text style={{
        fontSize: 9,
        letterSpacing: 2,
        textTransform: 'uppercase',
        color,
        fontWeight: '700',
      }}>
        {label}
      </Text>
    </View>
  )
}

function RequirementRow({ label, met }: { label: string; met: boolean }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 2 }}>
      <View style={{
        width: 13,
        height: 13,
        borderRadius: 7,
        borderWidth: 1.5,
        borderColor: met ? CYAN : 'rgba(255,255,255,0.2)',
        backgroundColor: met ? 'rgba(77,249,237,0.15)' : 'transparent',
        alignItems: 'center',
        justifyContent: 'center',
      }}>
        {met && (
          <View style={{
            width: 5,
            height: 5,
            borderRadius: 3,
            backgroundColor: CYAN,
          }} />
        )}
      </View>
      <Text style={{
        fontSize: 10,
        color: met ? 'rgba(77,249,237,0.85)' : 'rgba(255,255,255,0.35)',
        letterSpacing: 0.2,
        flex: 1,
      }}>
        {label}
      </Text>
    </View>
  )
}

function PasswordField({
  label,
  value,
  onChange,
  placeholder,
  showPassword,
  onToggleShow,
  borderColor,
  autoFocus,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder: string
  showPassword: boolean
  onToggleShow: () => void
  borderColor?: string
  autoFocus?: boolean
}) {
  const [focused, setFocused] = useState(false)

  const border = borderColor
    ?? (focused ? 'rgba(77,249,237,0.3)' : 'rgba(255,255,255,0.11)')

  return (
    <View style={{ gap: 5 }}>
      <Text style={{
        fontSize: 9,
        fontWeight: '700',
        letterSpacing: 2.5,
        textTransform: 'uppercase',
        color: 'rgba(255,255,255,0.45)',
      }}>
        {label}
      </Text>
      <View style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        paddingHorizontal: 10,
        paddingVertical: 10,
        borderRadius: 10,
        backgroundColor: 'rgba(27,27,27,0.7)',
        borderWidth: 1,
        borderColor: border,
      }}>
        <Text style={{ fontSize: 13, opacity: 0.3 }}>🔒</Text>

        <TextInput
          value={value}
          onChangeText={onChange}
          secureTextEntry={!showPassword}
          placeholder={placeholder}
          placeholderTextColor="rgba(255,255,255,0.2)"
          autoFocus={autoFocus}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          style={{
            flex: 1,
            color: '#fff',
            fontSize: 13,
            letterSpacing: 0.3,
          }}
        />

        <Pressable
          onPress={onToggleShow}
          style={{ padding: 2, opacity: 0.4 }}
          hitSlop={8}
        >
          <Text style={{ color: '#fff', fontSize: 10, letterSpacing: 1 }}>
            {showPassword ? 'HIDE' : 'SHOW'}
          </Text>
        </Pressable>
      </View>
    </View>
  )
}

function SuccessView() {
  return (
    <View style={{
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 20,
      paddingHorizontal: 24,
    }}>
      <View style={{
        width: 80,
        height: 80,
        borderRadius: 40,
        backgroundColor: 'rgba(77,249,237,0.08)',
        borderWidth: 1,
        borderColor: 'rgba(77,249,237,0.25)',
        alignItems: 'center',
        justifyContent: 'center',
      }}>
        <Text style={{ fontSize: 32 }}>✓</Text>
      </View>

      <View style={{ alignItems: 'center', gap: 6 }}>
        <Text style={{
          color: '#fff',
          fontSize: 20,
          fontWeight: '800',
          letterSpacing: 3,
          textTransform: 'uppercase',
          textAlign: 'center',
        }}>
          Password Updated
        </Text>
        <Text style={{ color: MUTED, fontSize: 13, textAlign: 'center' }}>
          Redirecting to your dashboard…
        </Text>
      </View>

      <View style={{ flexDirection: 'row', gap: 6 }}>
        {[0, 1, 2].map(i => (
          <View key={i} style={{
            width: 6,
            height: 6,
            borderRadius: 3,
            backgroundColor: CYAN,
            opacity: 0.6 + i * 0.2,
          }} />
        ))}
      </View>
    </View>
  )
}

export default function ChangePasswordPage() {
  const authReady = useAuthHydrated()
  const user = useAuthStore(s => s.user)
  const setUser = useAuthStore(s => s.setUser)

  const [password, setPassword] = useState('')
  const [confirmPw, setConfirmPw] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)

  const { width, height } = useWindowDimensions()

  // Breakpoints
  const isSmall = width < 360   // tiny phones
  const isCompact = width < 420   // most phones
  const isTablet = width >= 600  // tablets / landscape

  const cardMaxWidth = isTablet ? 480 : '100%'
  const cardPadding = isSmall ? 12 : isCompact ? 14 : 18
  const contentHorizontal = isSmall ? 12 : isCompact ? 16 : isTablet ? 48 : 24
  const headerIconSize = isSmall ? 30 : isCompact ? 34 : 38
  const headerTitleSize = isSmall ? 14 : isCompact ? 16 : 18
  const bodyTextSize = isSmall ? 10 : 11
  const requirePadding = isSmall ? 10 : isCompact ? 12 : 14
  const buttonPadding = isSmall ? 11 : isCompact ? 13 : 15
  const cardGap = isSmall ? 12 : 14

  const reqColumns = isSmall ? 1 : 2

  const strength = getStrength(password)
  const allMet = strength === REQUIREMENTS.length
  const passwordsMatch = password === confirmPw && confirmPw.length > 0
  const canSubmit = allMet && passwordsMatch && !loading

  useEffect(() => {
    if (!authReady || done) return
    if (!user) { router.replace('/sign-in'); return }
    if (!user.must_change_password) {
      router.replace(getMobileRoute(user.role) as any)
    }
  }, [authReady, user, done])

  const handleSubmit = useCallback(async () => {
    if (!canSubmit) return
    setError(null)
    setLoading(true)
    try {
      await changePassword(password)
      const me = await getMe()
      setUser({ ...me, must_change_password: false })
      setDone(true)
      setTimeout(() => {
        router.replace(getMobileRoute(me.role) as any)
      }, 1800)
    } catch (err: any) {
      setError(
        err?.response?.data?.message ??
        err?.message ??
        'Failed to update password. Please try again.',
      )
    } finally {
      setLoading(false)
    }
  }, [canSubmit, password, setUser])

  if (!authReady || !user) {
    return (
      <View style={{ flex: 1, backgroundColor: BG_MAIN, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={CYAN} />
      </View>
    )
  }

  if (done) {
    return (
      <View style={{ flex: 1, backgroundColor: BG_MAIN }}>
        <SuccessView />
      </View>
    )
  }

  const confirmBorder =
    confirmPw.length > 0
      ? passwordsMatch
        ? 'rgba(77,249,237,0.3)'
        : 'rgba(239,68,68,0.35)'
      : undefined

  return (
    <View style={{ flex: 1, backgroundColor: BG_MAIN }}>

      {/* Top cyan accent line */}
      <View style={{ height: 1, backgroundColor: CYAN, opacity: 0.35 }} />

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 20}
      >
        <View style={{
          flex: 1,
          justifyContent: 'center',
          alignItems: 'center',
          paddingHorizontal: contentHorizontal,
          paddingVertical: 16,
        }}>

          {/* ── Header ── */}
          <View style={{
            width: '100%',
            maxWidth: cardMaxWidth,
            marginBottom: isSmall ? 16 : 20,
          }}>
            <Text style={{
              fontSize: 9,
              letterSpacing: 3.5,
              textTransform: 'uppercase',
              color: 'rgba(255,255,255,0.2)',
              marginBottom: 12,
            }}>
              Security Setup
            </Text>

            <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 12 }}>
              <View style={{
                width: headerIconSize,
                height: headerIconSize,
                borderRadius: headerIconSize / 3,
                backgroundColor: 'rgba(77,249,237,0.1)',
                borderWidth: 1,
                borderColor: 'rgba(77,249,237,0.2)',
                alignItems: 'center',
                justifyContent: 'center',
                marginTop: 2,
              }}>
                <Text style={{ fontSize: isSmall ? 13 : 15 }}>🔒</Text>
              </View>

              <View style={{ flex: 1, gap: 3 }}>
                <Text style={{
                  color: '#fff',
                  fontSize: headerTitleSize,
                  fontWeight: '800',
                  letterSpacing: 2,
                  textTransform: 'uppercase',
                  lineHeight: headerTitleSize + 6,
                }}>
                  Set Your{'\n'}Password
                </Text>
                <Text style={{
                  color: 'rgba(255,255,255,0.35)',
                  fontSize: bodyTextSize,
                  lineHeight: 16,
                  letterSpacing: 0.2,
                }}>
                  Welcome,{' '}
                  <Text style={{ color: 'rgba(77,249,237,0.75)' }}>
                    {user.first_name ?? user.email}
                  </Text>
                  .{' '}A new password is required to continue.
                </Text>
              </View>
            </View>
          </View>

          {/* ── Card ── */}
          <View style={{
            backgroundColor: BG_CARD,
            borderRadius: 16,
            borderWidth: 1,
            borderColor: 'rgba(255,255,255,0.07)',
            padding: cardPadding,
            gap: cardGap,
            width: '100%',
            maxWidth: cardMaxWidth,
            shadowColor: '#000',
            shadowOffset: { width: 0, height: 12 },
            shadowOpacity: 0.5,
            shadowRadius: 24,
            elevation: 12,
          }}>

            {/* New password */}
            <View style={{ gap: 4 }}>
              <PasswordField
                label="New Password"
                value={password}
                onChange={v => { setPassword(v); setError(null) }}
                placeholder="Create a strong password"
                showPassword={showPassword}
                onToggleShow={() => setShowPassword(v => !v)}
                autoFocus
              />
              {password.length > 0 && <StrengthBar strength={strength} />}
            </View>

            {/* Confirm password */}
            <View style={{ gap: 4 }}>
              <PasswordField
                label="Confirm Password"
                value={confirmPw}
                onChange={v => { setConfirmPw(v); setError(null) }}
                placeholder="Repeat your password"
                showPassword={showConfirm}
                onToggleShow={() => setShowConfirm(v => !v)}
                borderColor={confirmBorder}
              />
              {confirmPw.length > 0 && !passwordsMatch && (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 }}>
                  <View style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: ERROR }} />
                  <Text style={{ color: 'rgba(248,113,113,0.8)', fontSize: 10, letterSpacing: 0.2 }}>
                    Passwords do not match
                  </Text>
                </View>
              )}
            </View>

            {/* Requirements */}
            <View style={{
              backgroundColor: 'rgba(255,255,255,0.03)',
              borderWidth: 1,
              borderColor: 'rgba(255,255,255,0.07)',
              borderRadius: 12,
              padding: requirePadding,
              gap: 3,
            }}>
              <Text style={{
                fontSize: 9,
                letterSpacing: 2.5,
                textTransform: 'uppercase',
                color: 'rgba(255,255,255,0.25)',
                marginBottom: 4,
              }}>
                Requirements
              </Text>

              {reqColumns === 1 ? (
                <View style={{ gap: 1 }}>
                  {REQUIREMENTS.map((req, i) => (
                    <RequirementRow key={i} label={req.label} met={req.test(password)} />
                  ))}
                </View>
              ) : (
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <View style={{ flex: 1, gap: 1, minWidth: 0 }}>
                    {REQUIREMENTS.slice(0, 3).map((req, i) => (
                      <RequirementRow key={i} label={req.label} met={req.test(password)} />
                    ))}
                  </View>
                  <View style={{ flex: 1, gap: 1, minWidth: 0 }}>
                    {REQUIREMENTS.slice(3).map((req, i) => (
                      <RequirementRow key={i} label={req.label} met={req.test(password)} />
                    ))}
                  </View>
                </View>
              )}
            </View>

            {/* Error */}
            {error && (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <View style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: ERROR }} />
                <Text style={{ color: 'rgba(248,113,113,0.85)', fontSize: 11, flex: 1 }}>
                  {error}
                </Text>
              </View>
            )}

            {/* Submit */}
            <Pressable
              onPress={handleSubmit}
              disabled={!canSubmit}
              style={({ pressed }) => ({
                backgroundColor: canSubmit
                  ? pressed ? '#e0e0e0' : '#ffffff'
                  : 'rgba(255,255,255,0.15)',
                borderRadius: 12,
                paddingVertical: buttonPadding,
                alignItems: 'center',
                opacity: canSubmit ? 1 : 0.4,
              })}
            >
              {loading ? (
                <ActivityIndicator color="#0a0a0a" size="small" />
              ) : (
                <Text style={{
                  color: '#0a0a0a',
                  fontSize: 11,
                  fontWeight: '700',
                  letterSpacing: 2.5,
                  textTransform: 'uppercase',
                }}>
                  Set Password & Continue
                </Text>
              )}
            </Pressable>
          </View>

          {/* Footer */}
          <Text style={{
            textAlign: 'center',
            color: 'rgba(255,255,255,0.2)',
            fontSize: 10,
            letterSpacing: 1.5,
            marginTop: 14,
          }}>
            You will only need to do this once.
          </Text>
        </View>
      </KeyboardAvoidingView>
    </View>
  )
}