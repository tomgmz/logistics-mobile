export const C = {
  bg:           '#0a0a0a',
  surface:      '#111111',
  surfaceHi:    '#1a1a1a',
  surfaceMid:   '#161616',
  border:       '#242424',
  borderHi:     '#2e2e2e',
  cyan:         '#00e5ff',
  cyanDim:      'rgba(0,229,255,0.12)',
  cyanGlow:     'rgba(0,229,255,0.25)',
  white:        '#ffffff',
  dimWhite:     'rgba(255,255,255,0.55)',
  dimmer:       'rgba(255,255,255,0.25)',
  dimmest:      'rgba(255,255,255,0.12)',
  green:        '#3af626',
  greenDim:     'rgba(58,246,38,0.15)',
  orange:       '#f59e0b',
  orangeDim:    'rgba(245,158,11,0.15)',
  red:          '#ef4444',
  redDim:       'rgba(239,68,68,0.15)',
  overlay:      'rgba(0,0,0,0.85)',
  bannerBg:     '#0a2026',
  bannerBorder: 'rgba(0,229,255,0.18)',
  offlineBg:    '#1a1200',
  offlineBorder:'rgba(245,158,11,0.35)',
  rerouteBg:    '#0d1a2e',
  rerouteBorder:'rgba(0,229,255,0.4)',
} as const

import MapboxGL from '@rnmapbox/maps'
export const MAPBOX_STYLE = MapboxGL.StyleURL.Street

export const STEP_ADVANCE_M    = 40 
export const OFF_ROUTE_M       = 80
export const OFF_ROUTE_HOLD_MS = 6_000
export const ROUTE_REFRESH_MS  = 60_000