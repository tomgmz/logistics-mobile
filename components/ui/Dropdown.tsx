import React, { useState } from 'react'
import { StyleSheet, Text, TouchableOpacity, View, type StyleProp, type ViewStyle } from 'react-native'
import Svg, { Path } from 'react-native-svg'

import { FONTS } from '../../lib/config/fonts'

/**
 * The app's one dropdown (Figma 8338 LOGISTICS SERVICES, node 2488:12478,
 * 2026-11-29): a full-width 23 px bar with a thin grey edge, the chosen value
 * in cyan Darker Grotesque Bold capitals and a small cyan chevron on the right.
 * Tapping it opens the choices right under it (the Figma draws only the closed
 * bar, so the list uses the same card look). Use this for every mobile
 * dropdown and for status filters instead of a row of chips.
 */

export type DropdownOption<T extends string> = {
  value: T
  label: string
  /** A number shown on the right (e.g. how many rows that filter has). */
  count?: number
  /** Short grey text on the right instead of a count. */
  note?:  string
}

const C = {
  line:   '#424242',
  card:   '#0e1010',
  cyan:   '#4df9ed',
  cyanBg: 'rgba(77,249,237,0.08)',
  white:  '#ffffff',
  faint:  '#818181',
  badge:  '#1e2020',
}

/** The Figma's chevron (12×12), flipped while open. */
function Chevron({ open }: { open: boolean }) {
  return (
    <Svg width={12} height={12} viewBox="0 0 12 12" fill="none" style={open ? { transform: [{ rotate: '180deg' }] } : undefined}>
      <Path d="M3 4.5L6 7.5L9 4.5" stroke={C.cyan} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  )
}

export default function Dropdown<T extends string>({
  value, options, onChange, label, accessibilityLabel, style,
}: {
  value:    T
  options:  DropdownOption<T>[]
  onChange: (v: T) => void
  /** Text on the bar; defaults to the chosen option's label. */
  label?:   string
  /** What the dropdown chooses, for screen readers (e.g. "Filter bookings"). */
  accessibilityLabel?: string
  style?:   StyleProp<ViewStyle>
}) {
  const [open, setOpen] = useState(false)
  const current = options.find((o) => o.value === value)
  const barText = (label ?? current?.label ?? '').toUpperCase()

  return (
    <View style={style}>
      <TouchableOpacity
        onPress={() => setOpen((o) => !o)}
        activeOpacity={0.75}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={`${accessibilityLabel ?? 'Choose'}: ${barText.toLowerCase()}`}
        hitSlop={{ top: 10, bottom: 10 }}
        style={styles.bar}
      >
        <Text style={styles.barText} numberOfLines={1}>{barText}</Text>
        <Chevron open={open} />
      </TouchableOpacity>

      {open && (
        <View style={styles.list}>
          {options.map((o, i) => {
            const on = o.value === value
            return (
              <TouchableOpacity
                key={o.value}
                onPress={() => { onChange(o.value); setOpen(false) }}
                activeOpacity={0.75}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
                style={[styles.item, i > 0 && styles.itemLine, on && { backgroundColor: C.cyanBg }]}
              >
                <Text style={[styles.itemText, on && { color: C.cyan }]} numberOfLines={1}>{o.label}</Text>
                {o.count !== undefined ? (
                  <View style={styles.badge}>
                    <Text style={[styles.badgeText, on && { color: C.cyan }]}>{o.count}</Text>
                  </View>
                ) : o.note ? (
                  <Text style={styles.note} numberOfLines={1}>{o.note}</Text>
                ) : null}
              </TouchableOpacity>
            )
          })}
        </View>
      )}
    </View>
  )
}

const DG = FONTS.darker

const styles = StyleSheet.create({
  // Figma: 321×23, 0.5 px #424242 edge, radius 8, label 7 px in, chevron 4 px from the right.
  bar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    height: 23, borderRadius: 8, borderWidth: 0.5, borderColor: C.line,
    paddingLeft: 6.5, paddingRight: 4,
  },
  barText: { flex: 1, color: C.cyan, fontSize: 14, lineHeight: 17, fontFamily: DG.bold },

  list: {
    marginTop: 4, borderRadius: 8, borderWidth: 0.5, borderColor: C.line,
    backgroundColor: C.card, overflow: 'hidden',
  },
  item: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8,
    minHeight: 40, paddingHorizontal: 10,
  },
  itemLine:  { borderTopWidth: 0.5, borderTopColor: C.line },
  itemText:  { flex: 1, color: C.white, fontSize: 14, lineHeight: 17, fontFamily: DG.bold },
  note:      { color: C.faint, fontSize: 12, lineHeight: 15, fontFamily: DG.bold },
  badge:     {
    minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 5,
    alignItems: 'center', justifyContent: 'center', backgroundColor: C.badge,
  },
  badgeText: { color: C.faint, fontSize: 11, lineHeight: 13, fontFamily: DG.bold },
})
