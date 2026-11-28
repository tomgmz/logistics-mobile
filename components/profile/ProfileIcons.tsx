import React from 'react'
import Svg, { Circle, Defs, G, Line, LinearGradient, Path, Stop } from 'react-native-svg'

/**
 * The driver Profile's icons, copied path for path from the Figma
 * (8338 LOGISTICS SERVICES, frames 2530:1771 / 2530:1974, 2026-11-29) so they
 * match the design exactly instead of a look-alike from the icon set.
 */

const CYAN = '#4DF9ED'
const RED  = '#F62626'

/** Round back button: dark circle, grey ring, white chevron (35×35). */
export function BackCircleIcon({ size = 35 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 35 35" fill="none">
      <Circle cx={17.5} cy={17.5} r={17.25} fill="#0E1010" stroke="#424242" strokeWidth={0.5} />
      <Path d="M20 24L14 18L20 12" stroke="#FFFFFF" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  )
}

/** The avatar disc: dark teal with a cyan ring (99×99). */
export function AvatarRing({ size = 99 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 99 99" fill="none">
      <Circle cx={49.5} cy={49.5} r={49} fill="#011C1A" stroke={CYAN} strokeWidth={1} />
    </Svg>
  )
}

/** "Request Change Password" key (12×12). */
export function KeyIcon({ size = 12 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 12 12" fill="none">
      <Path
        d="M1.293 8.707C1.10545 8.89449 1.00006 9.1488 1 9.414V10.5C1 10.6326 1.05268 10.7598 1.14645 10.8536C1.24021 10.9473 1.36739 11 1.5 11H3C3.13261 11 3.25979 10.9473 3.35355 10.8536C3.44732 10.7598 3.5 10.6326 3.5 10.5V10C3.5 9.86739 3.55268 9.74021 3.64645 9.64645C3.74021 9.55268 3.86739 9.5 4 9.5H4.5C4.63261 9.5 4.75979 9.44732 4.85355 9.35355C4.94732 9.25979 5 9.13261 5 9V8.5C5 8.36739 5.05268 8.24021 5.14645 8.14645C5.24021 8.05268 5.36739 8 5.5 8H5.586C5.85119 7.99994 6.10551 7.89455 6.293 7.707L6.7 7.3C7.39492 7.54207 8.15142 7.54115 8.84574 7.29738C9.54006 7.0536 10.1311 6.58142 10.5222 5.95806C10.9133 5.33471 11.0812 4.59709 10.9986 3.86587C10.9159 3.13465 10.5876 2.45313 10.0672 1.93278C9.54687 1.41244 8.86535 1.08409 8.13413 1.00144C7.40291 0.918797 6.66529 1.08675 6.04194 1.47782C5.41858 1.86889 4.9464 2.45994 4.70262 3.15426C4.45885 3.84858 4.45793 4.60508 4.7 5.3L1.293 8.707Z"
        stroke={CYAN} strokeLinecap="round" strokeLinejoin="round"
      />
      <Path
        d="M8.25 4C8.38807 4 8.5 3.88807 8.5 3.75C8.5 3.61193 8.38807 3.5 8.25 3.5C8.11193 3.5 8 3.61193 8 3.75C8 3.88807 8.11193 4 8.25 4Z"
        fill={CYAN} stroke={CYAN} strokeLinecap="round" strokeLinejoin="round"
      />
    </Svg>
  )
}

/** "Passkey Setup" shield with a keyhole (12×12). */
export function PasskeyShieldIcon({ size = 12 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 12 12" fill="none">
      <Path d="M6 6.5V8" stroke={CYAN} strokeLinecap="round" strokeLinejoin="round" />
      <Path
        d="M10 6.5C10 9 8.25 10.25 6.17 10.975C6.06108 11.0119 5.94277 11.0101 5.835 10.97C3.75 10.25 2 9 2 6.5V3C2 2.86739 2.05268 2.74021 2.14645 2.64645C2.24021 2.55268 2.36739 2.5 2.5 2.5C3.5 2.5 4.75 1.9 5.62 1.14C5.72593 1.0495 5.86068 0.999775 6 0.999775C6.13932 0.999775 6.27407 1.0495 6.38 1.14C7.255 1.905 8.5 2.5 9.5 2.5C9.63261 2.5 9.75979 2.55268 9.85355 2.64645C9.94732 2.74021 10 2.86739 10 3V6.5Z"
        stroke={CYAN} strokeLinecap="round" strokeLinejoin="round"
      />
      <Path
        d="M7 5.5C7 6.05228 6.55228 6.5 6 6.5C5.44772 6.5 5 6.05228 5 5.5C5 4.94772 5.44772 4.5 6 4.5C6.55228 4.5 7 4.94772 7 5.5Z"
        stroke={CYAN} strokeLinecap="round" strokeLinejoin="round"
      />
    </Svg>
  )
}

/** "Open User Guide" book with a gear (12×12). */
export function GuideBookIcon({ size = 12 }: { size?: number }) {
  const p = { stroke: CYAN, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }
  return (
    <Svg width={size} height={size} viewBox="0 0 12 12" fill="none">
      <Path d="M1.5 9.5C2.18409 9.10504 2.96009 8.89711 3.75 8.89711C4.53991 8.89711 5.31591 9.10504 6 9.5C6.1623 9.40627 6.33029 9.32278 6.503 9.25" {...p} />
      <Path d="M1.5 3C2.18409 2.60504 2.96009 2.39711 3.75 2.39711C4.53991 2.39711 5.31591 2.60504 6 3C6.68409 2.60504 7.46009 2.39711 8.25 2.39711C9.03991 2.39711 9.81591 2.60504 10.5 3" {...p} />
      <Path d="M1.5 3V9.5" {...p} />
      <Path d="M6 3V9.5" {...p} />
      <Path d="M10.5 3V6" {...p} />
      <Path d="M8.5005 9.5C8.5005 9.76522 8.60586 10.0196 8.79339 10.2071C8.98093 10.3946 9.23528 10.5 9.5005 10.5C9.76572 10.5 10.0201 10.3946 10.2076 10.2071C10.3951 10.0196 10.5005 9.76522 10.5005 9.5C10.5005 9.23478 10.3951 8.98043 10.2076 8.79289C10.0201 8.60536 9.76572 8.5 9.5005 8.5C9.23528 8.5 8.98093 8.60536 8.79339 8.79289C8.60586 8.98043 8.5005 9.23478 8.5005 9.5Z" {...p} />
      <Path d="M9.5005 7.75V8.5" {...p} />
      <Path d="M9.5005 10.5V11.25" {...p} />
      <Path d="M11.016 8.625L10.3665 9" {...p} />
      <Path d="M8.635 10L7.985 10.375" {...p} />
      <Path d="M7.985 8.625L8.635 9" {...p} />
      <Path d="M10.3665 10L11.0165 10.375" {...p} />
    </Svg>
  )
}

/** "Sign Out" arrow into a bar (16×16). */
export function SignOutIcon({ size = 16 }: { size?: number }) {
  const p = { stroke: RED, strokeWidth: 1.5, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }
  return (
    <Svg width={size} height={size} viewBox="0 0 16 16" fill="none">
      <Path d="M9.33333 8H2.66667" {...p} />
      <Path d="M9.33333 8L6.66667 10.6667" {...p} />
      <Path d="M9.33333 8L6.66667 5.33333" {...p} />
      <Path d="M13.3333 2.66667V13.3333" {...p} />
    </Svg>
  )
}

/**
 * The dashed line between Password and Passkey: 2 px dashes that fade in from
 * the card colour at both ends (the Figma's two mirrored 145 px gradient lines).
 */
export function FadedDashedLine() {
  return (
    <Svg width="100%" height={1} viewBox="0 0 290 1" preserveAspectRatio="none">
      <Defs>
        <LinearGradient id="fade" x1="0" y1="0" x2="290" y2="0" gradientUnits="userSpaceOnUse">
          <Stop offset="0" stopColor="#0E1010" />
          <Stop offset="0.113" stopColor="#424242" />
          <Stop offset="0.887" stopColor="#424242" />
          <Stop offset="1" stopColor="#0E1010" />
        </LinearGradient>
      </Defs>
      <G>
        <Line x1={0} y1={0.5} x2={290} y2={0.5} stroke="url(#fade)" strokeWidth={1} strokeDasharray="2.014 2.014" />
      </G>
    </Svg>
  )
}
