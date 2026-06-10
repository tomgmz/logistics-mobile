import React from 'react'
import {
  ArrowUp, ArrowUpLeft, ArrowUpRight,
  CornerUpLeft, CornerUpRight,
  RotateCcw, RefreshCw,
  MapPin,
} from 'lucide-react-native'
import { C } from '../../../theme/navigation.theme'

interface ManeuverIconProps {
  maneuver?: string
  size?:     number
  color?:    string
}

export function ManeuverIcon({ maneuver, size = 30, color = C.cyan }: ManeuverIconProps) {
  const sw = 2.5
  const m = (maneuver ?? '').toLowerCase().replace(/_/g, '-')

  if (!m || m.includes('straight') || m === '')
    return <ArrowUp size={size} color={color} strokeWidth={sw} />
  if (m.includes('turn-left') || m === 'left')
    return <CornerUpLeft size={size} color={color} strokeWidth={sw} />
  if (m.includes('turn-right') || m === 'right')
    return <CornerUpRight size={size} color={color} strokeWidth={sw} />
  if (m.includes('slight-left') || m.includes('bear-left'))
    return <ArrowUpLeft size={size} color={color} strokeWidth={sw} />
  if (m.includes('slight-right') || m.includes('bear-right'))
    return <ArrowUpRight size={size} color={color} strokeWidth={sw} />
  if (m.includes('uturn'))
    return <RotateCcw size={size} color={color} strokeWidth={sw} />
  if (m.includes('roundabout') || m.includes('rotary'))
    return <RefreshCw size={size} color={color} strokeWidth={sw} />
  if (m.includes('merge') || m.includes('ramp') || m.includes('fork'))
    return <ArrowUpRight size={size} color={color} strokeWidth={sw} />
  if (m.includes('destination'))
    return <MapPin size={size} color={C.orange} strokeWidth={sw} />
  return <ArrowUp size={size} color={color} strokeWidth={sw} />
}