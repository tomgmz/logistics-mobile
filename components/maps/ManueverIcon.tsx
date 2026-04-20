import React from 'react'
import {
  ArrowUp, ArrowUpLeft, ArrowUpRight,
  CornerUpLeft, CornerUpRight,
  RotateCcw, RefreshCw,
  MapPin,
} from 'lucide-react-native'
import { C } from '../../theme/navigation.theme'

interface ManeuverIconProps {
  maneuver?: string
  size?:     number
  color?:    string
}

export function ManeuverIcon({ maneuver, size = 30, color = C.cyan }: ManeuverIconProps) {
  const sw = 2.5
  if (!maneuver || maneuver.includes('straight') || maneuver === '')
    return <ArrowUp size={size} color={color} strokeWidth={sw} />
  if (maneuver.includes('turn-left')    || maneuver === 'left')
    return <CornerUpLeft size={size} color={color} strokeWidth={sw} />
  if (maneuver.includes('turn-right')   || maneuver === 'right')
    return <CornerUpRight size={size} color={color} strokeWidth={sw} />
  if (maneuver.includes('slight-left')  || maneuver.includes('bear-left'))
    return <ArrowUpLeft size={size} color={color} strokeWidth={sw} />
  if (maneuver.includes('slight-right') || maneuver.includes('bear-right'))
    return <ArrowUpRight size={size} color={color} strokeWidth={sw} />
  if (maneuver.includes('uturn'))
    return <RotateCcw size={size} color={color} strokeWidth={sw} />
  if (maneuver.includes('roundabout') || maneuver.includes('rotary'))
    return <RefreshCw size={size} color={color} strokeWidth={sw} />
  if (maneuver.includes('merge') || maneuver.includes('ramp') || maneuver.includes('fork'))
    return <ArrowUpRight size={size} color={color} strokeWidth={sw} />
  if (maneuver.includes('destination'))
    return <MapPin size={size} color={C.orange} strokeWidth={sw} />
  return <ArrowUp size={size} color={color} strokeWidth={sw} />
}