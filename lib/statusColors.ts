/**
 * Status colours, copied from the web so a status is the same colour on both
 * (user 2026-11-29). Change both apps together.
 *
 *   bookings ← logistics-frontend src/lib/palette.ts BOOKING_STATUS_COLOR
 *   reports  ← logistics-frontend src/components/reports/DriverReportDetailModal.tsx reportStatusStyle
 */

export const PALETTE = {
  cyan:   '#4df9ed',
  green:  '#3af626',
  yellow: '#ffea00',
  orange: '#ff7a30',
  red:    '#f62626',
  purple: '#8a38f5',
} as const

/** Assigned's violet in the Figma status legend (1122:820). */
export const ASSIGNED_VIOLET = '#a024ff'

export const BOOKING_STATUS_COLOR: Record<string, string> = {
  pending:    PALETTE.yellow,
  booked:     PALETTE.yellow,
  approved:   PALETTE.orange,
  assigned:   ASSIGNED_VIOLET,
  in_transit: PALETTE.cyan,
  arrived:    PALETTE.cyan,
  delivered:  '#ffffff',
  completed:  PALETTE.green,
  failed:     PALETTE.red,
  cancelled:  PALETTE.red,
}

/** Not on the web: the driver still owes "back at the parking". Palette purple. */
export const RETURN_COLOR = PALETTE.purple

export const REPORT_STATUS_COLOR = {
  reported:     PALETTE.red,
  acknowledged: PALETTE.yellow,
  resolved:     PALETTE.green,
} as const
