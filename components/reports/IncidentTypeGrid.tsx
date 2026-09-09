import React from 'react'
import { Text, TouchableOpacity, View } from 'react-native'
import { CarFront, BatteryCharging, HeartPulse, ShieldAlert } from 'lucide-react-native'

import { FONTS } from '../../lib/config/fonts'
import type { IncidentType } from '../../lib/api/reports.api'

/**
 * The four incident tiles, shared by the quick alert and the detailed form.
 *
 * Deliberately big, square and colour-coded, and deliberately only four. This is
 * tapped by someone who has just had an accident, is standing on a hard shoulder
 * or is being threatened — the target has to be findable without reading, which
 * is what the colour and the icon are for, and the list has to be short enough
 * to take in at a glance.
 *
 * Selection is optional on the quick alert: an alert sent without a tile is
 * logged as an unspecified emergency, which is far better than one not sent
 * because the driver could not decide which box it went in.
 */

const TILES: Array<{
  type:  IncidentType
  label: string
  color: string
  Icon:  typeof CarFront
}> = [
  { type: 'accident',          label: 'ACCIDENT',          color: '#f62626', Icon: CarFront        },
  { type: 'vehicle_breakdown', label: 'VEHICLE\nBREAKDOWN', color: '#ffea00', Icon: BatteryCharging },
  { type: 'health_emergency',  label: 'HEALTH\nEMERGENCY',  color: '#ff7a30', Icon: HeartPulse      },
  { type: 'security_threat',   label: 'SECURITY\nTHREAT',   color: '#8a38f5', Icon: ShieldAlert     },
]

const D = {
  card: '#0e1010',
  line: '#424242',
  sel:  '#4df9ed',
}

interface Props {
  value:    IncidentType | null
  onChange: (type: IncidentType | null) => void
  /** Compact tiles for the quick-alert sheet, which has a countdown and a send track to fit too. */
  compact?: boolean
  disabled?: boolean
}

export function IncidentTypeGrid({ value, onChange, compact = false, disabled = false }: Props) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
      {TILES.map(({ type, label, color, Icon }) => {
        const selected = value === type
        return (
          <TouchableOpacity
            key={type}
            disabled={disabled}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            accessibilityLabel={label.replace('\n', ' ')}
            // Tapping the selected tile clears it. On the quick alert that is
            // the difference between "I picked wrong" and having to cancel the
            // whole thing and start the countdown again.
            onPress={() => onChange(selected ? null : type)}
            style={{
              flexBasis:       '47%',
              flexGrow:        1,
              minHeight:       compact ? 118 : 138,
              alignItems:      'center',
              justifyContent:  'center',
              gap:             compact ? 8 : 12,
              paddingVertical: compact ? 12 : 16,
              paddingHorizontal: 8,
              borderRadius:    12,
              borderWidth:     selected ? 1.5 : 0.5,
              borderColor:     selected ? D.sel : D.line,
              backgroundColor: D.card,
              opacity:         disabled ? 0.5 : 1,
            }}
          >
            <Icon size={compact ? 30 : 36} color={color} strokeWidth={1.8} />
            <Text
              style={{
                color,
                fontSize:   compact ? 14 : 16,
                lineHeight: compact ? 17 : 19,
                textAlign:  'center',
                fontFamily: FONTS.spartan.bold,
              }}
            >
              {label}
            </Text>
          </TouchableOpacity>
        )
      })}
    </View>
  )
}
