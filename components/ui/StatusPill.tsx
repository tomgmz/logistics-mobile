import React from 'react'
import { Text, View } from 'react-native'

import { FONTS } from '../../lib/config/fonts'

/**
 * The app's one status pill (Figma 8338 LOGISTICS SERVICES, "tag" 2522:1577,
 * 2026-11-29): rounded, 0.4 px edge in the status colour, the colour at 19 %
 * behind it, a 6 px dot and the label in Darker Grotesque Medium 12 capitals.
 * The colour per status is the web's (lib/statusColors.ts), so a status reads
 * the same on the phone as on the web.
 */

/** "#rrggbb" + alpha → rgba(). */
function withAlpha(hex: string, a: number): string {
  const h = hex.replace('#', '')
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16)
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`
}

/** A darker shade of the same colour (mixed with black), so text stays readable on a light tint. */
function shade(hex: string, keep: number): string {
  const h = hex.replace('#', '')
  const n = parseInt(h, 16)
  const c = (v: number) => Math.round(v * keep)
  return `rgb(${c((n >> 16) & 255)},${c((n >> 8) & 255)},${c(n & 255)})`
}

export default function StatusPill({
  label, color, onLight = false,
}: {
  label:    string
  color:    string
  /**
   * On a white card: same idea, other way round — a light tint of the colour
   * behind, the colour as the outline, and a darker shade of it for the dot and
   * text so they stay readable (cyan text on a pale cyan would not be).
   */
  onLight?: boolean
}) {
  const isWhite = color.toLowerCase() === '#ffffff' || color.toLowerCase() === '#fff'
  const ink     = onLight ? shade(color, 0.55) : color
  const edge    = onLight && isWhite ? ink : color
  return (
    <View
      style={{
        flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start',
        height: 16, paddingLeft: 8, paddingRight: 8, borderRadius: 16,
        borderWidth: onLight ? 0.8 : 0.4, borderColor: edge,
        backgroundColor: withAlpha(isWhite && onLight ? '#818181' : color, 0.19),
      }}
    >
      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: ink }} />
      <Text
        numberOfLines={1}
        style={{ color: ink, fontSize: 12, lineHeight: 14, fontFamily: FONTS.darker.medium, includeFontPadding: false }}
      >
        {label.toUpperCase()}
      </Text>
    </View>
  )
}
