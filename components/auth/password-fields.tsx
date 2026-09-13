import { useState } from 'react'
import { Pressable, Text, TextInput, View } from 'react-native'

/**
 * The password composer, shared by every screen that sets a password: the
 * forced change after a temporary password, and the reset a driver lands on
 * from an emailed link.
 *
 * It lives here so the five rules below have exactly one definition. They have
 * to agree with what the server will accept, and a second copy drifting out of
 * step would show a driver five green ticks and then a rejection.
 */

export const CYAN    = '#4DF9ED'
export const BG_MAIN = '#0a0a0a'
export const BG_CARD = 'rgba(20,20,20,0.85)'
export const ERROR   = '#f87171'
export const MUTED   = 'rgba(255,255,255,0.35)'

interface Requirement {
  label: string
  test: (v: string) => boolean
}

export const REQUIREMENTS: Requirement[] = [
  { label: 'At least 8 characters', test: v => v.length >= 8 },
  { label: 'One uppercase letter (A–Z)', test: v => /[A-Z]/.test(v) },
  { label: 'One lowercase letter (a–z)', test: v => /[a-z]/.test(v) },
  { label: 'One number (0–9)', test: v => /\d/.test(v) },
  { label: 'One special character (!@#…)', test: v => /[^A-Za-z0-9]/.test(v) },
]

export function getStrength(password: string): number {
  return REQUIREMENTS.filter(r => r.test(password)).length
}

const STRENGTH_COLORS = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#4df9ed']
const STRENGTH_LABELS = ['', 'Weak', 'Fair', 'Good', 'Strong', 'Excellent']

export function StrengthBar({ strength }: { strength: number }) {
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

export function RequirementRow({ label, met }: { label: string; met: boolean }) {
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

export function PasswordField({
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

/** Every rule met — the server's bar, asked before a submit rather than after. */
export function meetsRequirements(password: string): boolean {
  return REQUIREMENTS.every((r) => r.test(password))
}
