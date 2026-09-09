import api from './auth.api'

/**
 * The driver's Reports module — what used to be the (empty) Maintenance tab.
 *
 * Two ways in, one record. The QUICK ALERT is the SOS: one tap, a countdown, and
 * it goes with whatever it has — location, vehicle and driver are already known,
 * so a useful alert can be sent without the driver typing anything. The DETAILED
 * REPORT is the same row with the fields they had time to fill in.
 *
 * They are not separate endpoints because they are not separate facts. A driver
 * who sends the alert first and describes it afterwards should end up with ONE
 * incident in front of operations, not two.
 */

export type IncidentType =
  | 'accident'
  | 'vehicle_breakdown'
  | 'health_emergency'
  | 'security_threat'

export type ReportStatus = 'reported' | 'acknowledged' | 'resolved'
export type ReportSource = 'quick' | 'detailed'

/** The ten items of the BLOWBAGETS pre-trip check. Battery and Brakes share a letter, so the keys differ. */
export interface BlowbagetsItems {
  battery: boolean
  lights:  boolean
  oil:     boolean
  water:   boolean
  brakes:  boolean
  air:     boolean
  gas:     boolean
  engine:  boolean
  tires:   boolean
  self:    boolean
}

export interface DriverReport {
  report_id:     string
  booking_id:    string | null
  truck_id:      string | null
  source:        ReportSource
  incident_type: IncidentType | null
  sub_type:      string | null
  description:   string | null
  photo_urls:    string[]
  video_urls:    string[]
  latitude:      number | null
  longitude:     number | null
  address:       string | null
  blowbagets_check:  { items: BlowbagetsItems; checked_at: string } | null
  trip_can_continue: boolean | null
  status:        ReportStatus
  created_at:    string
  bookings?: { booking_id: string; reference_number: string | null; origin: string } | null
  trucks?: {
    truck_id:     string
    plate_number: string
    truck_models?: { name: string | null; vehicle_type: string | null } | null
  } | null
}

export interface CreateReportInput {
  source:             ReportSource
  booking_id?:        string | null
  incident_type?:     IncidentType | null
  sub_type?:          string | null
  description?:       string | null
  photo_urls?:        string[]
  video_urls?:        string[]
  latitude?:          number | null
  longitude?:         number | null
  accuracy_m?:        number | null
  address?:           string | null
  blowbagets_items?:  BlowbagetsItems | null
  trip_can_continue?: boolean | null
}

export async function listMyReports(): Promise<DriverReport[]> {
  const { data } = await api.get('/driver/reports')
  return data.data ?? []
}

export async function createReport(input: CreateReportInput): Promise<DriverReport> {
  const { data } = await api.post('/driver/reports', input)
  return data.data
}

/**
 * Fill in a report that was already sent.
 *
 * This is what stops the quick alert from being a dead end: the driver fires the
 * one-tap signal so somebody is already moving, then comes back and says what
 * happened. Photos and videos accumulate rather than replace.
 */
export async function enrichReport(
  reportId: string,
  patch: Partial<CreateReportInput>,
): Promise<DriverReport> {
  const { data } = await api.patch(`/driver/reports/${reportId}`, patch)
  return data.data
}

/* ── Labels ───────────────────────────────────────────────────────────────── */

export const INCIDENT_LABEL: Record<IncidentType, string> = {
  accident:          'ACCIDENT',
  vehicle_breakdown: 'VEHICLE BREAKDOWN',
  health_emergency:  'HEALTH EMERGENCY',
  security_threat:   'SECURITY THREAT',
}

/**
 * What the driver can pick under each incident type.
 *
 * Free text on the wire rather than an enum, because every one of these lists
 * ends in "Other" — the categories are a prompt to think, not a closed set, and
 * a driver whose situation is not on the list must still be able to file.
 */
export const SUB_TYPES: Record<IncidentType, string[]> = {
  accident: [
    'Vehicle collision',
    'Rollover/vehicle overturned',
    'Cargo-related accident',
    'Other',
  ],
  vehicle_breakdown: [
    'Total breakdown',
    'Brakes or mechanical failure',
    'Fire',
    'Other',
  ],
  health_emergency: [
    'Driver injured',
    'Driver unwell / unfit to drive',
    'Third party injured',
    'Other',
  ],
  security_threat: [
    'Hijacking or hold-up',
    'Theft or pilferage',
    'Threat or harassment',
    'Other',
  ],
}

/** Tag colours, matching the list screen's status pills. */
export const STATUS_TONE: Record<ReportStatus, { label: string; color: string; bg: string }> = {
  reported:     { label: 'REPORTED',     color: '#f62626', bg: 'rgba(246,38,38,0.19)'  },
  acknowledged: { label: 'ACKNOWLEDGED', color: '#ff7a30', bg: 'rgba(255,122,48,0.19)' },
  resolved:     { label: 'RESOLVED',     color: '#3af626', bg: 'rgba(58,246,38,0.19)'  },
}
