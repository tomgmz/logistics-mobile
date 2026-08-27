import React from 'react'
import Svg, { Path } from 'react-native-svg'

/**
 * The two edit glyphs on the availability pill, traced from the Figma component
 * (node 2877:221). Neither is a stock lucide icon — both are a pencil with a
 * second mark composed onto it — so the exported paths are inlined here rather
 * than substituting a near-miss from the icon set.
 *
 * Both are drawn on the same 16×16 box as the lucide icons they sit beside, so
 * they line up with `Power` in the pill without per-icon nudging.
 */

const PENCIL = 'M2.66667 13.3333H5.33333L12.3333 6.33333C12.5084 6.15824 12.6473 5.95037 12.7421 5.72159C12.8368 5.49282 12.8856 5.24762 12.8856 5C12.8856 4.75238 12.8368 4.50718 12.7421 4.27841C12.6473 4.04963 12.5084 3.84176 12.3333 3.66667C12.1582 3.49157 11.9504 3.35268 11.7216 3.25792C11.4928 3.16315 11.2476 3.11438 11 3.11438C10.7524 3.11438 10.5072 3.16315 10.2784 3.25792C10.0496 3.35268 9.84176 3.49157 9.66667 3.66667L2.66667 10.6667V13.3333Z'
const NIB    = 'M9 4.33333L11.6667 7'

interface IconProps {
  size?:  number
  color?: string
}

/** Pencil with an up-arrow — "open the calendar" on the collapsed pill. */
export function PencilUpIcon({ size = 16, color = '#4df9ed' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 16 16" fill="none">
      <Path d={PENCIL} stroke={color} strokeLinecap="round" strokeLinejoin="round" />
      <Path d={NIB}    stroke={color} strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M12.6667 14.6667V10.6667"           stroke={color} strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M14.6667 12.6667L12.6667 10.6667L10.6667 12.6667" stroke={color} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  )
}

/** Pencil with a check — "save this month" on the open calendar. */
export function PencilCheckIcon({ size = 16, color = '#4df9ed' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 16 16" fill="none">
      <Path d={PENCIL} stroke={color} strokeLinecap="round" strokeLinejoin="round" />
      <Path d={NIB}    stroke={color} strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M10 12.6667L11.3333 14L14 11.3333" stroke={color} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  )
}
