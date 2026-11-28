import React, { useCallback, useEffect, useRef, useState } from 'react'
import Dropdown from '../../ui/Dropdown'
import { callDayNote } from '../../../lib/driverCallDay'
import {
  ActivityIndicator,
  Modal,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { router } from 'expo-router'
import NetInfo from '@react-native-community/netinfo'
import { isOnline } from '../../../lib/network'
import {
  AlertCircle,
  Boxes,
  Camera,
  Check,
  Clock,
  ChevronDown,
  ChevronLeft,
  ChevronUp,
  Eye,
  ImageUp,
  Lock,
  MapPin,
  MapPinCheck,
  Navigation,
  PackageCheck,
  Repeat,
  Road,
  Truck,
  User,
  Warehouse,
  WifiOff,
  X,
} from 'lucide-react-native'

import FileImage from '../../FileImage'
import api from '../../../lib/api/auth.api'
import { saveBookingCache, loadBookingCache } from '../../../lib/navCache'
import { bookingRef, fetchBookingBody, memoryBookingBody } from '../../../lib/driverBookings'
import { navigationGate, formatGateDate } from '../../../lib/deliveryWindow'
import { syncServerTime } from '../../../lib/serverTime'
import { FONTS } from '../../../lib/config/fonts'
import { groupCargoByDestination, manifestFor, manifestForTripStop } from '../../../lib/cargoManifest'
import {
  fetchTripsWithCache,
  recordLocalProgress,
  isMultiTrip,
  tripProgressCounts,
  type Trip,
  type TripStop,
} from '../../../lib/trips'
import {
  confirmTripStop,
  completeBooking,
  confirmFleetReturn,
  confirmLoadTransfer,
  type StopProofContext,
} from '../../../lib/tripProgress'
import { attachStopProof } from '../../../lib/api/stopProof.api'
import { StopProofModal } from './StopProofModal'
import { ConfirmDialog } from '../../ui/ConfirmDialog'
import CoachMarkTour, { CoachStep } from '../../CoachMarkTour'
import { useCoachTarget } from '../../../lib/coachMarks'
import { captureProofPhoto, CameraPermissionError, photoTakenAt, uploadProofPhoto } from '../../../lib/proofPhoto'
import { readCurrentFix } from '../../../lib/stopGeofence'
import { queuedIds, flush } from '../../../lib/offlineQueue'
import { loadResumableNavSession, endNavSession, type NavSession } from '../../../lib/navSession'
import { startDelivery, type StartOutcome } from '../../../lib/deliveryStart'
import { claimNavigation, heardAgo, type NavigatorState } from '../../../lib/navigationClaim'
import { useCrewWatch } from '../../../hooks/useCrewWatch'
import { useLiveSignal } from '../../../hooks/useLiveSignal'
import { useStopSteps, markStepProof, stepTimes, type StepTarget } from '../../../lib/stopSteps'
import { StopStepModal } from './StopStepModal'
import StatusPill from '../../ui/StatusPill'
import { BOOKING_STATUS_COLOR } from '../../../lib/statusColors'
import { currentPause, type TripPause } from '../../../lib/tripPause'
import { PausedBanner } from './PausedBanner'
import { DelayedBanner } from './DelayedBanner'
import { appAlert } from '../../../lib/appAlert'

/**
 * Assignment details — the screen a driver lands on from their booking list, and
 * the one they come back to.
 *
 * It has three faces, and they are the same cards throughout; only the state of
 * the work and the action at the bottom change:
 *
 *   REVIEWING   the job as briefed. Client, route, cargo, vehicle.
 *               → "Start Navigation"
 *   IN TRANSIT  the same, with each drop-off's progress and — the reason this
 *               screen matters — a way to supply proof of delivery that could
 *               not be sent at the bay.
 *               → "Complete Delivery?"
 *   COMPLETED   every bay confirmed, the documents listed against each one.
 *               → "Arrived Back at the Fleet?"
 *
 * The proof-upload path is the point of the in-transit face. A driver in a dead
 * zone confirms the stop and the photo goes in the offline queue — but an upload
 * can still fail outright (no storage, a photo that never took, a queue entry
 * that exhausted its retries). Before this, that delivery stayed unevidenced
 * forever: the stop was already confirmed, and a confirmed stop is idempotent.
 * Here the driver can come back — once signal returns, or after the whole
 * booking is done — and supply what is missing.
 *
 * Built from the Figma "Assignments Details" frames
 * (2937:940 reviewing, 2940:1532 in transit, 2940:1822 completed).
 */

interface Props {
  bookingId: string
  /** `earlyStart` is true when the driver chose to run this ahead of its day. */
  onStart:    (earlyStart: boolean) => void
  onPreview?: () => void
  onBack?:    () => void
}

interface Destination {
  destination_id: string
  address:        string
  sequence_order: number
  status:         'pending' | 'delivered' | 'failed'
  latitude:       number | null
  longitude:      number | null
}

interface HandlingCode {
  code: string
  name: string
  type: string
}

interface CargoItem {
  item_id:         string
  /** The drop-off this line is bound for. Null on pre-existing bookings. */
  destination_id?: string | null
  product_text?:   string | null
  commodity_text?: string | null
  shc_text?:       string | null
  ashc_text?:      string | null
  products?:       { name: string; unit?: string | null } | null
  commodities?:    { name: string; category?: string | null } | null
  shc?:            HandlingCode | null
  ashc?:           HandlingCode | null
  quantity?:       number | null
  weight_kg?:      number | null
  volume_cbm?:     number | null
  length_cm?:      number | null
  width_cm?:       number | null
  height_cm?:      number | null
  /** Unit the client typed the size in; sizes are stored in cm. null = cm. */
  dimension_unit?: string | null
}

interface Booking {
  booking_id:        string
  reference_number?: string | null
  origin:            string
  status:            string
  /** Set once the driver confirmed the vehicle was back in the company lot. */
  fleet_return_at?:  string | null
  schedule_date:     string
  call_time:         string
  /** Set by operations: when the driver leaves so the truck is at the pickup by call_time. */
  driver_call_time?: string | null
  /** Its day (booking day or the day before); null = the booking day. */
  driver_call_date?: string | null
  truck_type_needed: string
  clients?: {
    company_name?: string | null
    users?: { first_name?: string; last_name?: string; phone?: string | null } | null
  } | null
  booking_destinations?: Destination[]
  booking_cargo_items?:  CargoItem[]
  truck_assignments?: Array<{
    trucks?: { plate_number?: string; status?: string | null; truck_models?: { name?: string; vehicle_type?: string } | null } | null
  }>
  driver_assignments?: Array<{
    crew_role?: 'lead' | 'second'
    drivers?: { users?: { first_name?: string; last_name?: string } | null } | null
  }>
  /**
   * The seat this driver holds. 'second' means another driver runs the trip in
   * the app; this one sees the booking and its stops but cannot confirm anything.
   */
  my_crew_role?: 'lead' | 'second'
}

const D = {
  bg:       '#000000',
  card:     '#0e1010',
  cardLine: '#424242',
  inner:    '#1b1b1b',
  white:    '#ffffff',
  faint:    '#818181',
  cyan:     '#4df9ed',
  cyanDim:  'rgba(77,249,237,0.19)',
  green:    '#3af626',
  greenDim: 'rgba(58,246,38,0.19)',
  yellow:   '#ffea00',
  yellowDim:'rgba(255,234,0,0.19)',
  violet:   '#8a38f5',
  violetDim:'rgba(138,56,245,0.19)',
  orange:   '#ff7a30',
  orangeDim:'rgba(255,122,48,0.19)',
  red:      '#f62626',
  redDim:   'rgba(246,38,38,0.19)',
  divider:  'rgba(255,255,255,0.08)',
  amber:    '#ff7a30',
  amberBg:  '#1a1200',
}

/**
 * The tag beside the booking ref, one per state of the job.
 *
 * Pending and Approved read as Assigned here (user 2026-11-28, Figma
 * "Assignments Details [pending]"): a booking on this screen is one the driver
 * is assigned to, whatever stage the office is at. If it isn't released yet,
 * the lock note under the button says so.
 */
// Colours are the web's (lib/statusColors.ts); the pill is components/ui/StatusPill.
const ASSIGNED_TAG = { label: 'Assigned', color: BOOKING_STATUS_COLOR.assigned }
const STATUS_TAG: Record<string, { label: string; color: string }> = {
  pending:    ASSIGNED_TAG,
  approved:   ASSIGNED_TAG,
  assigned:   ASSIGNED_TAG,
  in_transit: { label: 'In Transit', color: BOOKING_STATUS_COLOR.in_transit },
  delivered:  { label: 'Delivered',  color: BOOKING_STATUS_COLOR.delivered },
  completed:  { label: 'Completed',  color: BOOKING_STATUS_COLOR.completed },
  failed:     { label: 'Failed',     color: BOOKING_STATUS_COLOR.failed },
  cancelled:  { label: 'Cancelled',  color: BOOKING_STATUS_COLOR.cancelled },
}

function fmtDate(d: string): string {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })
}

function fmtTime(t: string): string {
  if (!t) return ''
  const [h, m] = t.split(':')
  const hour = parseInt(h, 10)
  return `${hour % 12 || 12}:${m} ${hour >= 12 ? 'PM' : 'AM'}`
}

/** Prefer the catalogue row's name, fall back to the free-text the client typed. */
function pick(named: { name: string } | null | undefined, text: string | null | undefined): string | null {
  return named?.name ?? (text || null)
}

function codeLabel(code: HandlingCode | null | undefined, text: string | null | undefined): string | null {
  if (code) return code.code ? `${code.code}` : code.name
  return text || null
}

const CM_PER_UNIT = { cm: 1, m: 100, in: 2.54 } as const

/** The size as the client typed it (stored in cm, shown back in their unit; same as the web's lib/cargo/units). */
function dimensions(c: CargoItem): string | null {
  const { length_cm: l, width_cm: w, height_cm: h } = c
  if (l == null || w == null || h == null) return null
  const unit = c.dimension_unit === 'm' || c.dimension_unit === 'in' ? c.dimension_unit : 'cm'
  const show = (cm: number) => Math.round((Number(cm) / CM_PER_UNIT[unit]) * 1e4) / 1e4
  return `${show(l)} × ${show(w)} × ${show(h)} ${unit}`
}

/** First-visit tour of a delivery, shown the first time a driver opens one. */
const DETAILS_TOUR: CoachStep[] = [
  {
    target: 'booking.header',
    title:  'This delivery at a glance',
    body:   'The booking number, the day and call time, and its status, which changes as you pick up and deliver.',
  },
  {
    target: 'booking.route',
    title:  'The route',
    body:   'The pickup, then every drop-off. At each stop the app asks for a proof photo before the stop can be confirmed.',
  },
  {
    target: 'booking.actions',
    title:  'Your next step',
    body:   'This button always shows what to do next: Start Navigation on the delivery day, Complete Delivery when every stop is done, then confirm the vehicle is back. Preview route shows the map at any time.',
  },
]

/** GET /driver/bookings/:id/load-transfer — what the transfer step needs. */
interface LoadTransfer {
  replacement_id:     string
  trip_id:            string | null
  old_vehicle_plate:  string | null
  handover_latitude:  number | null
  handover_longitude: number | null
}

export default function BookingDetailsScreen({ bookingId, onStart, onPreview, onBack }: Props) {
  const insets = useSafeAreaInsets()

  /**
   * The dock's measured height, so the scroller can clear it.
   *
   * It can't be a constant: the dock grows a row whenever it has something
   * extra to say — the offline banner, the preview button, and above all the
   * lock note on a booking that isn't due yet — and a fixed guess left the last
   * card of the details buried under it in exactly those cases. The fallback is
   * the old guess, used only for the first frame before layout runs.
   */
  const [dockH, setDockH] = useState(0)

  const [loading,   setLoading]   = useState(true)
  const [error,     setError]     = useState<string | null>(null)
  const [booking,   setBooking]   = useState<Booking | null>(null)
  // The booking as on screen, for callbacks created before it last changed.
  const bookingNowRef = useRef<Booking | null>(null)
  bookingNowRef.current = booking
  const [offline,   setOffline]   = useState(false)
  const [fromCache, setFromCache] = useState(false)

  // The runs the truck makes. A booking whose cargo exceeds the body is the
  // SAME vehicle shuttling, so a drop-off can be visited on more than one run
  // and "is this bay done" is a question about the runs, not the bay.
  const [trips, setTrips] = useState<Trip[]>([])

  // The drop-off whose proof photo the driver is supplying, and whether the
  // stop still needs confirming or only its evidence.
  const [proofFor, setProofFor] = useState<
    { stop: TripStop; label: string; mode: 'confirm' | 'attach' } | null
  >(null)
  const [uploading, setUploading] = useState<string | null>(null)
  const [uploadError, setUploadError] = useState<string | null>(null)

  // The step popup (arrived → start → finished, then the proof) for one visit.
  const [stepFor, setStepFor] = useState<{
    target: StepTarget
    kind:   'pickup' | 'dropoff'
    label:  string
    stop?:  TripStop
    coords: { latitude: number; longitude: number } | null
  } | null>(null)
  const dropoffCoords = (stop: TripStop): { latitude: number; longitude: number } | null => {
    const d = stop.booking_destinations as { latitude?: number | null; longitude?: number | null } | null | undefined
    return d?.latitude != null && d?.longitude != null ? { latitude: Number(d.latitude), longitude: Number(d.longitude) } : null
  }

  // Which end-of-job confirmation is open, if any.
  const [dialog, setDialog] = useState<'complete' | 'return' | null>(null)
  const [dialogBusy, setDialogBusy] = useState(false)
  // Set locally the moment the driver confirms, so the button settles
  // immediately instead of waiting on a refetch that may be offline.
  const [returned, setReturned] = useState(false)

  // After the office replaced the vehicle on the road with the load on the old
  // one: this driver moves it across and confirms it before any drop-off.
  const [transfer, setTransfer] = useState<LoadTransfer | null>(null)
  // Arrived at parking / docked / started / departed at each stop, and the
  // total loaded per trip.
  const stopSteps = useStopSteps(bookingId)
  const [transferOpen, setTransferOpen] = useState(false)
  // The pause the office put on the delivery (weather, breakdown, closed stop…).
  // The driver can't pause or resume; only the office can.
  const [pause, setPause]         = useState<TripPause | null>(null)
  const pauseRef = useRef<TripPause | null>(null)
  pauseRef.current = pause

  const headerTarget  = useCoachTarget('booking.header')
  const routeTarget   = useCoachTarget('booking.route')
  const actionsTarget = useCoachTarget('booking.actions')
  const [finished, setFinished] = useState(false)

  // Which trip the route and cargo show on a multi-trip booking: a trip_id,
  // 'all', or null for the default (the trip under way; all once done).
  const [tripView, setTripView] = useState<string | null>(null)
  // Drop-off boxes the driver opened past their first two cargo lines.
  const [openDrops, setOpenDrops] = useState<Set<string>>(new Set())
  const toggleDrop = useCallback((key: string) => {
    setOpenDrops((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])
  // Stop times + vehicle, folded away under "Show more details" once the job is moving.
  const [moreOpen, setMoreOpen] = useState(false)
  // The proof photo opened from a drop-off's Documents.
  const [viewing, setViewing] = useState<string | null>(null)

  // What is confirmed on this phone but not on the server yet: drop-offs whose
  // confirmation (with its photo) is still in the offline queue, and the
  // booking completion. Polled while anything is waiting, so the rows settle on
  // their own once it goes out.
  const [sendingStops, setSendingStops] = useState<Set<string>>(new Set())
  const [completeWaiting, setCompleteWaiting] = useState(false)
  const refreshQueued = useCallback(async () => {
    const ids = await queuedIds()
    const stops = new Set(ids.filter((id) => id.startsWith('trip-stop:')).map((id) => id.slice('trip-stop:'.length)))
    setSendingStops((prev) => {
      // Something just went out: re-read the runs so its photo shows.
      if ([...prev].some((id) => !stops.has(id))) {
        void fetchTripsWithCache(bookingId).then(({ trips: t }) => setTrips(t)).catch(() => {})
      }
      return stops
    })
    setCompleteWaiting(ids.includes(`complete:${bookingId}`))
    return ids.length
  }, [bookingId])

  useEffect(() => {
    void refreshQueued()
    const timer = setInterval(() => {
      if (sendingStops.size === 0 && !completeWaiting) return
      void flush().finally(() => { void refreshQueued() })
    }, 5_000)
    return () => clearInterval(timer)
  }, [refreshQueued, sendingStops.size, completeWaiting])

  const load = useCallback(async () => {
    // This session's copy of the booking (shared query cache) shows at once;
    // the fresh read below replaces it. Without one, the spinner as before.
    const memory = memoryBookingBody(bookingId)?.data
    if (memory) setBooking(memory)
    setLoading(!memory)
    setError(null)

    // The gate below is only as good as our clock, and this is the screen where
    // it decides something. Re-sync in the background; the gate stays open until
    // it lands, and the server still refuses an early pickup either way.
    void syncServerTime()

    // The plan is fetched alongside the booking and never blocks it: a booking
    // that renders without its runs is still a readable briefing, while a screen
    // that refuses to open because the trip list timed out is a driver stuck at
    // a gate. `fetchTripsWithCache` falls back to its own cached copy first.
    void fetchTripsWithCache(bookingId)
      .then(({ trips: t }) => setTrips(t))
      .catch(() => {})

    try {
      const data = await fetchBookingBody(bookingId)
      setBooking(data.data)
      setFromCache(false)
      // Keep a copy so navigation can still derive its stops if the network
      // drops before/at start.
      saveBookingCache(bookingId, data.data)
      setPause(await currentPause(bookingId, data.data))
      if (data.data?.status === 'in_transit') {
        api.get(`/driver/bookings/${bookingId}/load-transfer`)
          .then(({ data: t }) => setTransfer(t.data ?? null))
          .catch(() => {})
      } else {
        setTransfer(null)
      }
    } catch (e: any) {
      // Network failed — fall back to the last cached copy if we have one, so
      // the driver still sees the job details instead of a dead end.
      const cached = await loadBookingCache<Booking>(bookingId)
      setPause(await currentPause(bookingId))
      if (cached) {
        setBooking(cached)
        setFromCache(true)
      } else {
        setError(e?.response?.data?.message ?? e?.message ?? 'Failed to load booking.')
      }
    } finally {
      setLoading(false)
    }
  }, [bookingId])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    const unsub = NetInfo.addEventListener((s) => setOffline(!isOnline(s)))
    return () => unsub()
  }, [])

  // Navigation already started for this booking on this phone — in memory, or
  // saved before the app was swiped away. Its guidance may still be running, so
  // the button offers to resume it rather than start over.
  const [resumable, setResumable] = useState<NavSession | null>(null)
  useEffect(() => {
    let alive = true
    void loadResumableNavSession(bookingId).then((s) => { if (alive) setResumable(s) })
    return () => { alive = false }
  }, [bookingId])

  const gate = navigationGate(booking)
  const currentGate = gate

  // Telling the server the delivery has started. The button waits on it: if the
  // office re-assigned the booking a moment ago, the map must not open.
  const [starting, setStarting] = useState(false)

  /**
   * The server is told first, then the map opens. A refusal is shown and the map
   * stays shut: re-assigned (403) re-reads the booking, which then reads as not
   * this driver's; anything else (cancelled, vehicle pulled) is the server's
   * sentence. Offline the start is queued and the map opens as before.
   */
  // A ref, not the `starting` state: a second tap in the same frame reads the
  // old state from its closure and would start (and prompt) twice.
  const beginBusyRef = useRef(false)
  const beginDelivery = useCallback(async (earlyStart: boolean, resuming = false) => {
    if (beginBusyRef.current) return
    beginBusyRef.current = true
    setStarting(true)
    try {
      await beginDeliveryInner(earlyStart, resuming)
    } finally {
      beginBusyRef.current = false
      setStarting(false)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookingId, onStart, load])

  /**
   * "Not fit to drive": the start is refused and the office told (online), so
   * they can arrange another driver. Nothing is queued offline: the map must not
   * open on a "queued" start, so the driver is asked to call instead.
   */
  const reportUnfit = async (earlyStart: boolean) => {
    if (offline) {
      appAlert('Call the office', 'You said you are not fit to drive. You are offline, so the office was not told. Call the Operations Manager so they can arrange another driver.')
      return
    }
    const outcome = await startDelivery(bookingId, earlyStart, false)
    if (typeof outcome === 'object') {
      appAlert('Delivery not started', outcome.refused)
    } else {
      // No answer from the server (it was queued, or it started anyway): say what to do.
      appAlert('Call the office', 'You said you are not fit to drive. Call the Operations Manager so they can arrange another driver.')
    }
    void load()
  }

  const beginDeliveryInner = async (earlyStart: boolean, resuming: boolean) => {
    // BLOWBAGETS Self (user 2026-11-28): the last S is the driver's own fitness,
    // which the Fleet Manager's vehicle inspection can't answer. Asked when the
    // driver sets off, not on Resume or once the delivery is already moving.
    let selfFit: boolean | undefined
    if (!resuming && bookingNowRef.current?.status === 'assigned') {
      const answer = await askSelfCheck()
      if (answer === null) return
      if (answer === 'unfit') {
        await reportUnfit(earlyStart)
        return
      }
      selfFit = true
    }
    const outcome: StartOutcome = await startDelivery(bookingId, earlyStart, selfFit)
    if (typeof outcome === 'object') {
      if (outcome.reassigned) {
        // Guidance left over from before the hand-over must not resume either.
        if (resuming) { endNavSession(); setResumable(null) }
        appAlert(
          'Delivery handed to another driver',
          'The office assigned this booking to another driver or vehicle, so it can’t be started from this phone.',
        )
        void load()
      } else {
        appAlert('Can’t start this delivery', outcome.refused)
      }
      return
    }

    // One phone navigates at a time (2026-11-21). Claimed before the map opens,
    // so a driver who decides not to take over never starts Google guidance.
    // Offline: the map opens anyway; the map screen claims once online.
    const claim = await claimNavigation(bookingId)
    if (claim.kind === 'refused') {
      appAlert('Can’t navigate this delivery', claim.message)
      return
    }
    if (claim.kind === 'held') {
      const takeOver = await askTakeOver(claim.state)
      if (!takeOver) return
      const again = await claimNavigation(bookingId, true)
      if (again.kind === 'refused') {
        appAlert('Can’t navigate this delivery', again.message)
        return
      }
    }
    onStart(earlyStart)
  }

  // Real time: the office changed this booking (call time, pause, vehicle or
  // driver, a step confirmed for the driver, a late confirmation decided), or
  // its route moved (a stop confirmed, a run loaded). Re-read quietly; the
  // screen keeps what it shows (memory copy) instead of a spinner. Also on
  // return to the foreground (signals sent in the background never arrived).
  useLiveSignal('live:bookings', (ids) => {
    if (ids.size === 0 || ids.has(bookingId)) void load()
  }, { debounceMs: 800 })
  useLiveSignal(`route:booking:${bookingId}`, () => { void load() }, { debounceMs: 800 })

  // Handed to another driver while this screen is open: say so and leave, and
  // drop any guidance saved for it so Resume can't reopen it.
  useCrewWatch(bookingId, useCallback(() => {
    endNavSession()
    setResumable(null)
    appAlert(
      'Delivery handed to another driver',
      'The office assigned this booking to another driver or vehicle. It’s no longer on your list.',
      [{ text: 'OK', onPress: onBack }],
    )
  }, [onBack]))

  // Held from the tap until the start runs or its question is answered: fast
  // repeated taps on Start (or on "Start early") used to stack the same pop-up
  // again and again, one per tap.
  const startBusyRef = useRef(false)
  const releaseStart = useCallback(() => { startBusyRef.current = false }, [])

  /**
   * The offline caveat, asked last so it wraps whichever start we're doing.
   * Returns true when it left a question on screen (its buttons release the guard).
   */
  const startWithOfflineCheck = useCallback((earlyStart: boolean): boolean => {
    if (offline) {
      appAlert(
        'You’re offline',
        'A new route can’t be started without a connection — the map provider needs network to build it. ' +
        'If this trip is already in progress, guidance will keep running on the route it already loaded.',
        [
          { text: 'Cancel', style: 'cancel', onPress: releaseStart },
          { text: 'Try anyway', style: 'default', onPress: () => { releaseStart(); void beginDelivery(earlyStart) } },
        ],
        { cancelable: true, onDismiss: releaseStart },
      )
      return true
    }
    void beginDelivery(earlyStart)
    return false
  }, [offline, beginDelivery, releaseStart])

  const handleStart = useCallback(async () => {
    if (startBusyRef.current || beginBusyRef.current) return
    startBusyRef.current = true
    let asking = false
    try {
      asking = await handleStartInner()
    } finally {
      // A question on screen releases the guard from its own buttons.
      if (!asking) startBusyRef.current = false
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentGate, offline, bookingId])

  /** Returns true when it left a question on screen (its buttons release the guard). */
  const handleStartInner = async (): Promise<boolean> => {
    // The screen was loaded once, maybe long before this tap — and the Fleet
    // Manager may have pulled the vehicle since. Re-read the booking first when
    // online, so the gate below decides on what is true now. Offline, the copy
    // on screen stands and the server still refuses the pickup.
    let gate = currentGate
    if (!offline) {
      try {
        const data = await fetchBookingBody(bookingId)
        setBooking(data.data)
        saveBookingCache(bookingId, data.data)
        gate = navigationGate(data.data)
      } catch {
        // Keep the gate we have.
      }
    }

    // Locked because the booking isn't the driver's to run at all — not
    // something an override should be able to talk its way past.
    if (gate.reason === 'cancelled') {
      appAlert('Booking cancelled', 'This booking has been cancelled and can’t be delivered.')
      return false
    }

    if (gate.reason === 'vehicle_out_of_service') {
      appAlert(
        'Vehicle out of service',
        'The Fleet Manager took this vehicle out of service. Don’t drive or load it — ' +
        'the Operations Manager will assign another vehicle, and navigation opens once they do.',
      )
      return false
    }

    if (gate.reason === 'not_assigned') {
      appAlert(
        'Not ready to start',
        'This booking hasn’t been assigned for delivery yet. It will open once the Operations Manager releases it.',
      )
      return false
    }

    // Scheduled for a later day. Startable, but the driver has to mean it, and
    // the choice is recorded against the pickup.
    if (gate.reason === 'not_yet' && gate.scheduledFor) {
      appAlert(
        'Not scheduled until ' + formatGateDate(gate.scheduledFor),
        'Starting now puts the delivery in transit ahead of the scheduled day, and that gets flagged on the booking. ' +
        'Only do this if the job really has moved up.',
        [
          { text: 'Cancel', style: 'cancel', onPress: releaseStart },
          {
            text: 'Start early',
            style: 'destructive',
            // The offline question (if any) takes the guard over.
            onPress: () => { if (!startWithOfflineCheck(true)) releaseStart() },
          },
        ],
        // Android: tapping outside closes it without a button.
        { cancelable: true, onDismiss: releaseStart },
      )
      return true
    }

    return startWithOfflineCheck(false)
  }


  /**
   * Back to a navigation that is already under way on this phone.
   *
   * No "not scheduled yet" question (the driver answered it when they started;
   * the answer rides along in the session) and no offline warning (guidance
   * that is still running needs no connection). If it turns out the guidance
   * died with the app, the map screen rebuilds the route or falls back to the
   * offline preview, exactly as a fresh start would.
   */
  const handleResume = useCallback(() => {
    if (transfer) {
      appAlert(
        'Move the load first',
        'Confirm the load transfer onto your vehicle before continuing to the drop-offs. ' +
        'Use “Open hand-over point” to get directions to where the old vehicle stopped.',
      )
      return
    }
    if (currentGate.reason === 'cancelled') {
      appAlert('Booking cancelled', 'This booking has been cancelled and can’t be delivered.')
      return
    }
    // Through the server too: Resume is how a start that never reached it (made
    // offline) gets there, and it is refused if the booking was handed over.
    void beginDelivery(!!resumable?.earlyStart, true)
  }, [currentGate, resumable, beginDelivery, transfer])

  // While paused, look again every 30 s so an office resume clears the banner.
  useEffect(() => {
    if (!pause || offline) return
    const t = setInterval(() => {
      fetchBookingBody(bookingId)
        .then(async (data) => setPause(await currentPause(bookingId, data.data)))
        .catch(() => {})
    }, 30_000)
    return () => clearInterval(t)
  }, [pause, offline, bookingId])

  /* ── Proof of delivery, supplied from here ──────────────────────────────
   *
   * Two different things behind one button, because to the driver they are one
   * thing — "this drop is done and here is the picture":
   *
   *   confirm  the stop was never confirmed. Full flow: photo AND position, the
   *            same modal the navigation map uses, so a stop confirmed from here
   *            carries the same evidence as one confirmed on the road.
   *   attach   the stop is confirmed and the photo is what is missing. Photo
   *            only — no position is captured, and none is written. Where the
   *            driver stood was recorded at the bay; a fix taken in the yard
   *            that evening must not overwrite it.
   */

  const openProof = useCallback((stop: TripStop, label: string) => {
    setUploadError(null)
    if (stop.status === 'pending') {
      // Paused by the office: no new progress (the server refuses it too).
      if (pauseRef.current) {
        appAlert('Delivery paused by the office',
          'You can’t confirm a drop-off while the delivery is paused. Ask the Operations Manager or the Company Administrator to end the pause.')
        return
      }
      // No step skipped (user 2026-11-12): the steps first (I've arrived within
      // 300 m, Start unloading, Unloading finished), then the proof.
      const target = { tripId: stop.trip_id, tripStopId: stop.trip_stop_id }
      void stepTimes(bookingId, target).then((times) => {
        if (times.finished && !times.proof) setProofFor({ stop, label, mode: 'confirm' })
        else setStepFor({ target, kind: 'dropoff', label, stop, coords: dropoffCoords(stop) })
      })
      return
    }
    // Confirmed already — only the evidence is outstanding, so skip the modal
    // and go straight to the camera.
    void attachPhoto(stop)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const attachPhoto = useCallback(async (stop: TripStop) => {
    setUploadError(null)
    try {
      const uri = await captureProofPhoto()
      if (!uri) return

      setUploading(stop.trip_stop_id)
      // Where the phone is now goes onto the photo's stamp only — never onto the
      // stop, whose position was recorded at the bay. The stamp also says the
      // picture was added after the stop was confirmed.
      const fix = await readCurrentFix()
      const url = await uploadProofPhoto(uri, {
        stop: 'trip_stop', refId: stop.trip_stop_id, takenAt: photoTakenAt(uri), fix, addedLater: true,
      })
      await attachStopProof(stop.trip_stop_id, url)

      // Reflect it without a round trip, so the row settles under the driver's
      // thumb even on a connection that only just came back.
      setTrips((prev) => prev.map((t) => ({
        ...t,
        booking_trip_stops: (t.booking_trip_stops ?? []).map((x) =>
          x.trip_stop_id === stop.trip_stop_id
            ? { ...x, proof_photo_url: url, proof_at: new Date().toISOString() }
            : x,
        ),
      })))
    } catch (e: any) {
      setUploadError(
        e instanceof CameraPermissionError
          ? e.message
          : e?.response?.data?.message ?? e?.message ?? 'The photo could not be uploaded. Try again.',
      )
    } finally {
      setUploading(null)
    }
  }, [])

  /** The load is on this driver's vehicle now. Queued, like a pickup. */
  const confirmTransfer = useCallback((photoUri: string, proof: StopProofContext) => {
    const pending = transfer
    setTransferOpen(false)
    if (!pending) return
    setTransfer(null)
    void confirmLoadTransfer(bookingId, pending.trip_id ?? bookingId, photoUri, proof)
  }, [transfer, bookingId])

  /** The full confirm-a-stop flow, from the modal. */
  const confirmStop = useCallback((photoUri: string, proof: StopProofContext) => {
    const target = proofFor
    setProofFor(null)
    if (!target) return

    // Durable: this goes through the offline queue exactly as a confirmation
    // from the navigation map does, so a stop confirmed here with no signal is
    // still sent when one returns.
    setSendingStops((prev) => new Set(prev).add(target.stop.trip_stop_id))
    confirmTripStop(target.stop.trip_stop_id, photoUri, proof, null)
      .catch(() => {})
      .finally(() => { void refreshQueued() })
    // The confirmation is the stop's finish: Departed is the next step to tap.
    void markStepProof(bookingId, { tripId: target.stop.trip_id, tripStopId: target.stop.trip_stop_id })
    void recordLocalProgress(bookingId, { confirmedStopId: target.stop.trip_stop_id })

    setTrips((prev) => prev.map((t) => ({
      ...t,
      booking_trip_stops: (t.booking_trip_stops ?? []).map((x) =>
        x.trip_stop_id === target.stop.trip_stop_id
          ? { ...x, status: 'delivered' as const, delivered_at: new Date().toISOString() }
          : x,
      ),
    })))
  }, [proofFor, refreshQueued, bookingId])

  /* ── Closing the job out ────────────────────────────────────────────────── */

  const onCompleteConfirmed = useCallback(async () => {
    setDialogBusy(true)
    try {
      await completeBooking(bookingId)
      setFinished(true)
    } catch { /* queued; the driver is not blocked on the network */ }
    // Kept on the phone, not lost — but say so, rather than looking finished
    // while the server still has the booking open.
    await refreshQueued()
    setDialogBusy(false)
    setDialog(null)
  }, [bookingId, refreshQueued])

  const onReturnConfirmed = useCallback(async () => {
    setDialogBusy(true)
    try {
      await confirmFleetReturn(bookingId)
      setReturned(true)
    } catch { /* queued */ }
    setDialogBusy(false)
    setDialog(null)
  }, [bookingId])

  if (loading) {
    return (
      <View style={s.centered}>
        <ActivityIndicator size="large" color={D.cyan} />
        <Text style={s.centeredText}>Loading booking…</Text>
      </View>
    )
  }

  if (error || !booking) {
    return (
      <View style={[s.centered, { paddingHorizontal: 32 }]}>
        <AlertCircle size={40} color={D.red} />
        <Text style={s.errorText}>{error ?? 'Booking not found.'}</Text>
        <TouchableOpacity onPress={load} style={s.retryBtn}>
          <Text style={s.retryText}>Retry</Text>
        </TouchableOpacity>
        {onBack && (
          <TouchableOpacity onPress={onBack} style={{ marginTop: 4, paddingVertical: 8, paddingHorizontal: 24 }}>
            <Text style={s.centeredText}>Go back</Text>
          </TouchableOpacity>
        )}
      </View>
    )
  }

  // EVERY drop-off, not just the outstanding ones. The in-transit and completed
  // faces of this screen are about what has been done as much as what is left,
  // and a bay that vanishes from the list the moment it is confirmed is exactly
  // the bay whose missing photo the driver came back here to supply.
  const dropoffs = [...(booking.booking_destinations ?? [])]
    .sort((a, b) => a.sequence_order - b.sequence_order)

  const cargo   = booking.booking_cargo_items ?? []
  const client  = booking.clients
  const contact = client?.users
    ? `${client.users.first_name ?? ''} ${client.users.last_name ?? ''}`.trim()
    : ''

  const truck      = booking.truck_assignments?.[0]?.trucks
  const truckModel = truck?.truck_models?.name ?? truck?.truck_models?.vehicle_type ?? booking.truck_type_needed
  const plate      = truck?.plate_number

  const tag = STATUS_TAG[booking.status] ?? STATUS_TAG.assigned


  /* ── Which face of this screen the driver is looking at ─────────────────── */

  // 'delivered' is done from the driver's side; 'completed' only adds the client's confirmation.
  const isDone     = finished || booking.status === 'delivered' || booking.status === 'completed' || booking.status === 'failed'
  const inTransit  = !isDone && booking.status === 'in_transit'
  const hasReturned = returned || !!booking.fleet_return_at

  // Main and second driver have the same buttons (2026-11-21): either may be
  // the one with a free phone. The server checks each write (on the crew, 100 m,
  // photo, phone with the truck) and the first confirmation of a stop wins.

  const shuttle = isMultiTrip(trips)
  const counts  = tripProgressCounts(trips)
  // Completing is only on offer once every drop-off is done — counting the ones
  // confirmed on this phone that have not synced yet (the trips are overlaid).
  // Offered earlier, the server refuses it, and the refusal sits in the offline
  // queue ahead of the stops the driver confirms next.
  const allStopsDone = counts.total > 0 && counts.done >= counts.total

  // Every planned visit, keyed by the bay it serves. A bay whose load takes two
  // runs has two of them, and each carries its own photo — so this is a list per
  // destination, never a single stop.
  const visitsByDestination = new Map<string, Array<{ trip: Trip; stop: TripStop }>>()
  for (const trip of trips) {
    if (trip.status === 'cancelled') continue
    for (const stop of trip.booking_trip_stops ?? []) {
      const list = visitsByDestination.get(stop.destination_id)
      if (list) list.push({ trip, stop })
      else visitsByDestination.set(stop.destination_id, [{ trip, stop }])
    }
  }
  for (const list of visitsByDestination.values()) {
    list.sort((a, b) => a.trip.trip_number - b.trip.trip_number)
  }

  // Cargo now says which drop-off it is for, so it is shown grouped by stop
  // rather than as one undifferentiated pile. Anything from a booking taken
  // before that was recorded has no destination and is listed under "whole
  // trip" — guessing would be worse than admitting we do not know.
  const grouped = groupCargoByDestination(cargo)
  const started = inTransit || isDone

  /* ── Sections: one route + cargo pair per trip shown ────────────────────
   *
   * Figma "delivery contents [pending] - w/trip": a multi-trip booking shows
   * one trip at a time (picker "TRIP 1 ▾") or all of them ("TRIPS ▾"), each
   * as its own route card and cargo card, split by a dashed line. A one-trip
   * booking is a single pair with no picker.
   */
  const liveTrips = trips
    .filter((t) => t.status !== 'cancelled')
    .sort((a, b) => a.trip_number - b.trip_number)
  const currentTrip = liveTrips.find((t) => t.status === 'in_transit')
    ?? liveTrips.find((t) => t.status === 'pending')
    ?? null
  const chosen = tripView ?? (isDone || !currentTrip ? 'all' : currentTrip.trip_id)
  // A trip the office cancelled since it was picked falls back to all trips.
  const view = chosen === 'all' || liveTrips.some((t) => t.trip_id === chosen) ? chosen : 'all'
  const dropNo = (destinationId: string) =>
    dropoffs.findIndex((d) => d.destination_id === destinationId) + 1

  const sections: Section[] = shuttle
    ? (view === 'all' ? liveTrips : liveTrips.filter((t) => t.trip_id === view)).map((trip) => {
        const stops = [...(trip.booking_trip_stops ?? [])].sort((a, b) => a.sequence_order - b.sequence_order)
        // The bay the truck is heading to now: the first open one on the run under way.
        const nextId = trip.status === 'in_transit'
          ? stops.find((st) => st.status === 'pending')?.trip_stop_id
          : undefined
        return {
          key:        trip.trip_id,
          trip,
          pickupDone: trip.status !== 'pending',
          stops: stops.map((st) => ({
            key:     st.trip_stop_id,
            label:   `Drop-off ${dropNo(st.destination_id) || '?'}`,
            address: st.booking_destinations?.address ?? '—',
            state:   pinState(st.status, st.trip_stop_id === nextId),
          })),
          drops: stops.map((st) => ({
            key:    st.trip_stop_id,
            label:  `DROP-OFF ${dropNo(st.destination_id) || '?'}`,
            items:  manifestForTripStop(grouped, st).items as CargoItem[],
            visits: [{ trip, stop: st }],
          })),
        }
      })
    : (() => {
        const doneOf = (d: Destination) => {
          const vs = visitsByDestination.get(d.destination_id) ?? []
          return d.status === 'delivered'
            || (vs.length > 0 && vs.every((v) => v.stop.status === 'delivered'))
        }
        const nextId = inTransit ? dropoffs.find((d) => !doneOf(d) && d.status !== 'failed')?.destination_id : undefined
        return [{
          key:        'single',
          trip:       null,
          pickupDone: started,
          stops: dropoffs.map((d, i) => ({
            key:     d.destination_id,
            label:   `Drop-off ${i + 1}`,
            address: d.address,
            state:   pinState(doneOf(d) ? 'delivered' : d.status, d.destination_id === nextId),
          })),
          drops: dropoffs.map((d, i) => ({
            key:    d.destination_id,
            label:  `DROP-OFF ${i + 1}`,
            items:  manifestFor(grouped, d.destination_id).items as CargoItem[],
            visits: visitsByDestination.get(d.destination_id) ?? [],
          })),
        }]
      })()

  // Lines from before cargo was bound to a drop-off ride with the last section.
  if (grouped.unassigned.items.length > 0 && sections.length > 0) {
    sections[sections.length - 1].drops.push({
      key: 'unassigned', label: 'WHOLE TRIP', items: grouped.unassigned.items as CargoItem[], visits: [],
    })
  }

  return (
    <View style={s.root}>
      <StatusBar barStyle="light-content" backgroundColor="transparent" translucent />

      {/* Header — back, ref and schedule, the status tag on the right */}
      <View ref={headerTarget} collapsable={false} style={[s.header, { paddingTop: insets.top + 8 }]}>
        {onBack && (
          <TouchableOpacity
            onPress={onBack}
            activeOpacity={0.75}
            accessibilityRole="button"
            accessibilityLabel="Go back"
            style={s.backBtn}
          >
            <ChevronLeft size={20} color={D.white} strokeWidth={2} />
          </TouchableOpacity>
        )}

        <View style={s.headerText}>
          <Text style={s.ref} numberOfLines={1}>
            {bookingRef(booking)}
          </Text>
          <Text style={s.schedule} numberOfLines={2}>
            {fmtDate(booking.schedule_date)}
            {booking.driver_call_time ? ` · Leave ${fmtTime(booking.driver_call_time)}${callDayNote(booking)}` : ''}
            {booking.call_time ? ` · Pick-up ${fmtTime(booking.call_time)}` : ''}
          </Text>
        </View>

        <StatusPill label={tag.label} color={tag.color} />
      </View>

      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: 19,
          paddingBottom:     (dockH || 140) + 16,
          gap:               15,
        }}
        showsVerticalScrollIndicator={false}
      >
        {/* Client */}
        {(client?.company_name || contact) && (
          <Card icon={<User size={16} color={D.cyan} />} title="CLIENT">
            <Text style={s.company} numberOfLines={1}>
              {(client?.company_name ?? contact).toUpperCase()}
            </Text>
            {client?.company_name && contact ? (
              <Text style={s.clientLine} numberOfLines={1}>{contact}</Text>
            ) : null}
            {client?.users?.phone ? (
              <Text style={s.clientLine} numberOfLines={1}>{client.users.phone}</Text>
            ) : null}
          </Card>
        )}

        {shuttle && <TripPicker trips={liveTrips} value={view} onChange={setTripView} />}

        {sections.map((sec, si) => {
          // A drop-off box is drawn when it has goods, or proof to supply / show.
          const drops = sec.drops.filter((d) => d.items.length > 0 || (started && d.visits.length > 0))
          const qty   = drops.reduce((n, d) => n + d.items.reduce((m, c) => m + (c.quantity ?? 0), 0), 0)
          return (
            <React.Fragment key={sec.key}>
              {si > 0 && <Dashes />}

              <View ref={si === 0 ? routeTarget : undefined} collapsable={false}>
                <Card
                  icon={<Road size={16} color={D.cyan} />}
                  title="ROUTE"
                  meta={`${sec.stops.length} DROP-OFF${sec.stops.length === 1 ? '' : 'S'}`}
                  right={sec.trip ? `TRIP ${sec.trip.trip_number}` : null}
                >
                  <View style={s.innerBox}>
                    <Stop
                      state={sec.pickupDone ? 'done' : 'pickup'}
                      label="Pickup"
                      address={booking.origin}
                      last={sec.stops.length === 0}
                    />
                    {sec.stops.map((st, i) => (
                      <Stop
                        key={st.key}
                        state={st.state}
                        label={st.label}
                        address={st.address}
                        last={i === sec.stops.length - 1}
                      />
                    ))}
                  </View>
                </Card>
              </View>

              {/* Cargo, boxed by the drop-off it comes off at — and, once the
                  job is moving, the proof for that stop directly under it: the
                  driver is answering "did THIS come off HERE", and the answer and
                  the evidence belong in one place. */}
              {drops.length > 0 && (
                <Card
                  icon={<Boxes size={16} color={D.cyan} />}
                  title="CARGO"
                  meta={qty > 0 ? `${qty} ITEM${qty === 1 ? '' : 'S'}` : null}
                >
                  <View style={{ gap: 12, marginTop: 12 }}>
                    {drops.map((d) => (
                      <DropBox
                        key={d.key}
                        label={d.label}
                        items={d.items}
                        flat={started}
                        collapsible={started}
                        expanded={openDrops.has(d.key)}
                        onToggle={() => toggleDrop(d.key)}
                      >
                        {started && d.visits.length > 0 && (
                          <StopProofSection
                            visits={d.visits}
                            shuttle={shuttle}
                            label={d.label === 'WHOLE TRIP' ? 'Drop-off' : `Drop-off ${d.label.replace('DROP-OFF ', '')}`}
                            uploading={uploading}
                            sending={sendingStops}
                            onUpload={openProof}
                            onView={setViewing}
                          />
                        )}
                      </DropBox>
                    ))}
                  </View>
                  {si === sections.length - 1 && uploadError ? <Text style={s.uploadError}>{uploadError}</Text> : null}
                </Card>
              )}
            </React.Fragment>
          )
        })}

        {/* The times at the loading and each drop-off, per trip: arrival
            (recorded by the app), start, finish, proof. Read only: the steps
            are worked on the navigation map (user 2026-11-28). A pick-up or
            delivery the office recorded for the driver says so, never
            "proof sent" — there is no photo. */}
        {started && moreOpen && liveTrips.length > 0 && (
          <Card icon={<Clock size={16} color={D.cyan} />} title="TRANSIT STOP TIMES">
            <View style={{ gap: 14, marginTop: 12 }}>
              {liveTrips.map((trip) => {
                const total   = stopSteps.totalFor(trip.trip_id)
                const pickupT = stopSteps.timesFor({ tripId: trip.trip_id })
                const visits  = [...(trip.booking_trip_stops ?? [])].sort((a, b) => a.sequence_order - b.sequence_order)
                const pickupByOffice = byOffice(trip.pickup_proof_photo_url, trip.pickup_proof_override_reason)
                return (
                  <View key={trip.trip_id} style={{ gap: 10 }}>
                    {shuttle && <Text style={s.timesTrip}>TRIP {trip.trip_number}</Text>}
                    <TimesBox
                      title="LOADING"
                      rows={[
                        ['Arrive at Pickup',  pickupT.arrived],
                        ['Start Loading',     pickupT.started],
                        ['Loading Finished',  pickupT.finished],
                        [pickupByOffice ? 'Picked Up (Recorded by the Office)' : 'Proof of Pickup',
                          trip.pickup_proof_at ?? pickupT.proof],
                        ...(total
                          ? [['Total Loaded', null, `${total.pieces.toLocaleString('en-PH')} pcs${total.weight_kg ? ` · ${total.weight_kg.toLocaleString('en-PH')} kg` : ''}`] as TimeRow]
                          : []),
                      ]}
                    />
                    {visits.map((stop) => {
                      const n = dropNo(stop.destination_id)
                      const t = stopSteps.timesFor({ tripId: trip.trip_id, tripStopId: stop.trip_stop_id })
                      const deliveredAt = stop.delivered_at ?? t.proof
                      const label = byOffice(stop.proof_photo_url, stop.proof_override_reason)
                        ? 'Delivered (Recorded by the Office)'
                        : sendingStops.has(stop.trip_stop_id)
                          ? 'Delivered (Photo Sending)'
                          : deliveredAt && !stop.proof_photo_url
                            ? 'Delivered (Photo Not Sent Yet)'
                            : 'Delivered (Proof Sent)'
                      return (
                        <TimesBox
                          key={stop.trip_stop_id}
                          title={`UNLOADING · DROP-OFF ${n || '?'}`}
                          rows={[
                            ['Arrive at Drop-off', t.arrived],
                            ['Start Unloading',    t.started],
                            ['Unloading Finished', t.finished],
                            [label,                deliveredAt],
                          ]}
                        />
                      )
                    })}
                  </View>
                )
              })}
            </View>
          </Card>
        )}

        {/* Vehicle — always before the start; behind "Show more" after it. */}
        {(!started || moreOpen) && (
          <Card icon={<Truck size={16} color={D.cyan} />} title="VEHICLE">
            <Text style={s.vehicle} numberOfLines={1}>
              {plate ? <Text style={{ color: D.cyan }}>{plate} </Text> : null}
              <Text style={{ color: plate ? D.faint : D.cyan }}>{truckModel}</Text>
            </Text>
            {/* Only while still in the yard: on the road it is Operations' call. */}
            {gate.reason === 'vehicle_out_of_service' && (
              <Text style={{ color: D.red, fontSize: 12, fontWeight: '700', marginTop: 6 }}>
                OUT OF SERVICE — do not drive or load this vehicle
              </Text>
            )}
          </Card>
        )}

        {started && (
          <TouchableOpacity
            onPress={() => setMoreOpen((o) => !o)}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityState={{ expanded: moreOpen }}
            accessibilityLabel={moreOpen ? 'Show less details' : 'Show more details: stop times and vehicle'}
            style={s.pageMore}
            hitSlop={8}
          >
            <Text style={s.pageMoreText}>{moreOpen ? 'SHOW LESS DETAILS' : 'SHOW MORE DETAILS'}</Text>
            {moreOpen
              ? <ChevronUp size={14} color={D.cyan} strokeWidth={2.5} />
              : <ChevronDown size={14} color={D.cyan} strokeWidth={2.5} />}
          </TouchableOpacity>
        )}
      </ScrollView>

      {/* Start navigation */}
      <View
        ref={actionsTarget}
        collapsable={false}
        style={[s.dock, { paddingBottom: insets.bottom + 14 }]}
        onLayout={(e) => {
          const h = Math.round(e.nativeEvent.layout.height)
          setDockH((prev) => (prev === h ? prev : h))
        }}
      >
        {completeWaiting && (
          <View style={s.offlineBanner}>
            <WifiOff size={15} color={D.amber} />
            <Text style={s.offlineText}>
              {sendingStops.size > 0
                ? 'Saved on this phone. "Mark booking as done" goes out right after the drop-offs still being sent.'
                : 'Saved on this phone. "Mark booking as done" is sent as soon as there is signal.'}
            </Text>
          </View>
        )}
        {offline && (
          <View style={s.offlineBanner}>
            <WifiOff size={15} color={D.amber} />
            <Text style={s.offlineText}>
              {fromCache
                ? 'Offline — showing the last saved copy. Reconnect to start a new route.'
                : 'Offline — reconnect to start a new route.'}
            </Text>
          </View>
        )}
        {/* Only while the job has not started. Once it is moving or finished
            the gate has nothing left to say — telling a driver who has already
            delivered that "navigation opens on the scheduled day" is noise
            sitting on top of the one button that still matters. */}
        {gate.locked && !inTransit && !isDone && !resumable && (
          <View style={s.lockNote}>
            <Lock size={13} color={D.faint} />
            <Text style={s.lockText}>
              {gate.reason === 'cancelled'
                ? 'This booking has been cancelled.'
                : gate.reason === 'vehicle_out_of_service'
                  ? `${plate ?? 'The vehicle'} was taken out of service. Wait for Operations to assign another vehicle.`
                : gate.reason === 'not_assigned'
                  ? 'Waiting on the Operations Manager to release this booking.'
                  : `Navigation opens ${gate.scheduledFor ? formatGateDate(gate.scheduledFor) : 'on the scheduled day'}.`}
            </Text>
          </View>
        )}

        {/* Always available before the start, above the start button (Figma
            pending frame): seeing the run is never gated, only running it. */}
        {onPreview && !isDone && !inTransit && (
          <TouchableOpacity
            activeOpacity={0.75}
            onPress={onPreview}
            accessibilityRole="button"
            accessibilityLabel="Preview the route on a map, view only"
            style={s.previewRouteBtn}
          >
            <Eye size={20} color={D.faint} strokeWidth={2} />
            <Text style={s.previewRouteText}>Preview Route</Text>
          </TouchableOpacity>
        )}

        {/* The one action this face of the screen is for.

            Deliberately one button, never a row of them: whatever state the job
            is in there is exactly one thing the driver should do next, and a
            phone in a cab is the worst place to offer a choice between similar
            green buttons. */}
        {isDone && hasReturned ? (
          <View style={s.doneNote}>
            <Check size={15} color={D.green} strokeWidth={3} />
            <Text style={s.doneNoteText}>Delivery complete and the vehicle is back at the fleet.</Text>
          </View>
        ) : isDone ? (
          <TouchableOpacity
            activeOpacity={0.85}
            onPress={() => setDialog('return')}
            accessibilityRole="button"
            accessibilityLabel="Confirm the vehicle is back at the fleet parking lot"
            style={[s.startBtn, { borderColor: D.violet, backgroundColor: D.violetDim }]}
          >
            <Warehouse size={20} color={D.violet} strokeWidth={2} />
            <Text style={[s.startText, { color: D.violet }]}>Arrived Back at the Fleet?</Text>
          </TouchableOpacity>
        ) : inTransit && allStopsDone ? (
          <TouchableOpacity
            activeOpacity={0.85}
            onPress={() => setDialog('complete')}
            accessibilityRole="button"
            accessibilityLabel="Mark this delivery as complete"
            style={[s.startBtn, { borderColor: D.green, backgroundColor: D.greenDim }]}
          >
            <PackageCheck size={20} color={D.green} strokeWidth={2} />
            <Text style={[s.startText, { color: D.green }]}>Complete Delivery?</Text>
          </TouchableOpacity>
        ) : inTransit || resumable ? (
          // Started already (the pickup may not be confirmed yet, so the booking
          // still reads as assigned) — straight back to the map, no questions.
          <TouchableOpacity
            activeOpacity={0.85}
            onPress={handleResume}
            disabled={starting}
            accessibilityRole="button"
            accessibilityLabel="Resume navigation for this delivery"
            style={[s.startBtn, starting && { opacity: 0.6 }]}
          >
            <Navigation size={20} color={D.cyan} strokeWidth={2} />
            <Text style={s.startText}>Resume Navigation</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            activeOpacity={0.85}
            onPress={() => void handleStart()}
            disabled={starting}
            accessibilityRole="button"
            accessibilityLabel={
              gate.reason === 'vehicle_out_of_service' ? 'Navigation locked, the vehicle is out of service'
              : gate.locked ? 'Navigation locked until the scheduled day' : 'Start navigation'
            }
            style={[s.startBtn, gate.locked && s.startBtnLocked, starting && { opacity: 0.6 }]}
          >
            {gate.locked
              ? <Lock size={18} color={D.faint} strokeWidth={2} />
              : <Navigation size={20} color={D.cyan} strokeWidth={2} />}
            <Text style={[s.startText, gate.locked && { color: D.faint }]}>Start Navigation</Text>
          </TouchableOpacity>
        )}

        {/* Resuming a run in progress. Separate from the completion button above
            so "get me back to the map" and "close this booking" can never be
            confused for one another. */}
        {inTransit && allStopsDone && (
          <TouchableOpacity
            activeOpacity={0.75}
            onPress={() => (resumable ? handleResume() : startWithOfflineCheck(false))}
            accessibilityRole="button"
            accessibilityLabel="Resume navigation for this delivery"
            style={s.previewBtn}
          >
            <Navigation size={16} color={D.white} strokeWidth={2} />
            <Text style={s.previewText}>Resume navigation</Text>
          </TouchableOpacity>
        )}

        {/* The vehicle was replaced with the load still on the old one. */}
        {transfer && !isDone && (
          <View style={[s.transferCard]}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Repeat size={16} color={D.amber} strokeWidth={2} />
              <Text style={s.transferTitle}>Move the load to your vehicle</Text>
            </View>
            <Text style={s.doneNoteText}>
              {`The office replaced ${transfer.old_vehicle_plate ?? 'the vehicle'} on this delivery. ` +
               'Go to where it stopped, move the load onto your vehicle, and confirm with a photo. ' +
               'The drop-offs open after that.'}
            </Text>
            {transfer.handover_latitude != null && transfer.handover_longitude != null && (
              <TouchableOpacity
                activeOpacity={0.75}
                onPress={() => router.push({
                  pathname: '/driver/maps',
                  params: {
                    lat:   String(transfer.handover_latitude),
                    lng:   String(transfer.handover_longitude),
                    label: `Hand-over point · ${transfer.old_vehicle_plate ?? 'replaced vehicle'}`,
                  },
                })}
                accessibilityRole="button"
                accessibilityLabel="Open the hand-over point on the map"
                style={s.previewBtn}
              >
                <MapPin size={16} color={D.white} strokeWidth={2} />
                <Text style={s.previewText}>Open hand-over point</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              activeOpacity={0.85}
              onPress={() => setTransferOpen(true)}
              accessibilityRole="button"
              accessibilityLabel="Confirm the load transfer with a photo"
              style={[s.previewBtn, { borderColor: D.amber }]}
            >
              <Camera size={16} color={D.amber} strokeWidth={2} />
              <Text style={[s.previewText, { color: D.amber }]}>Confirm load transfer</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* The office paused the delivery. Read-only: only Operations or the
            Company Administrator can resume it. */}
        {pause && !isDone && (
          <PausedBanner
            pause={pause}
            bookingId={bookingId}
            onChanged={() => {
              fetchBookingBody(bookingId)
                .then(async (data) => setPause(await currentPause(bookingId, data.data)))
                .catch(() => {})
            }}
          />
        )}
        {/* Running late (the server's delay flag); a pause explains itself instead. */}
        {!pause && !isDone && <DelayedBanner booking={booking} />}
      </View>

      {/* Confirming a stop from here rather than from the map: same modal, so a
          stop confirmed in the yard carries the same photo AND position as one
          confirmed on the road. */}
      {stepFor && (
        <StopStepModal
          visible
          kind={stepFor.kind}
          label={stepFor.label}
          times={stopSteps.timesFor(stepFor.target)}
          stop={stepFor.coords}
          onRecord={(stage) => stopSteps.record(stepFor.target, stage)}
          onProof={() => {
            const f = stepFor
            setStepFor(null)
            if (f.kind === 'dropoff' && f.stop) { setProofFor({ stop: f.stop, label: f.label, mode: 'confirm' }); return }
            appAlert('Proof of pickup', 'Take the proof of pickup from the navigation map (Start or Resume Navigation).')
          }}
          onClose={() => setStepFor(null)}
        />
      )}
      <StopProofModal
        visible={!!proofFor}
        title={proofFor?.label ?? 'Drop-off'}
        address={proofFor?.stop.booking_destinations?.address}
        kind="dropoff"
        stopCoordinates={
          proofFor?.stop.booking_destinations?.latitude != null &&
          proofFor?.stop.booking_destinations?.longitude != null
            ? {
                latitude:  proofFor.stop.booking_destinations.latitude,
                longitude: proofFor.stop.booking_destinations.longitude,
              }
            : null
        }
        manifest={proofFor ? manifestForTripStop(grouped, proofFor.stop) : null}
        onConfirm={confirmStop}
        onCancel={() => setProofFor(null)}
      />

      {/* Load transfer after a vehicle replacement: same photo + position modal
          as a pickup, measured against where the old vehicle stopped. */}
      <StopProofModal
        visible={transferOpen}
        title="Load transfer"
        address={transfer?.old_vehicle_plate ? `From ${transfer.old_vehicle_plate} to your vehicle` : undefined}
        kind="pickup"
        stopCoordinates={
          transfer?.handover_latitude != null && transfer?.handover_longitude != null
            ? { latitude: transfer.handover_latitude, longitude: transfer.handover_longitude }
            : null
        }
        manifest={null}
        onConfirm={confirmTransfer}
        onCancel={() => setTransferOpen(false)}
      />

      <ConfirmDialog
        visible={dialog === 'complete'}
        tone="green"
        title="Mark this delivery as done?"
        message="All required documents have been uploaded. Confirm delivery completion?"
        confirmLabel="Done"
        busy={dialogBusy}
        onConfirm={onCompleteConfirmed}
        onCancel={() => setDialog(null)}
      />

      <ConfirmDialog
        visible={dialog === 'return'}
        tone="violet"
        title="You have returned?"
        message="Confirm that the vehicle has been returned to the company parking lot."
        confirmLabel="Arrived"
        busy={dialogBusy}
        onConfirm={onReturnConfirmed}
        onCancel={() => setDialog(null)}
      />

      {/* A proof photo opened from a drop-off's Documents. */}
      <Modal
        visible={!!viewing}
        transparent
        animationType="fade"
        onRequestClose={() => setViewing(null)}
      >
        <View style={s.viewer}>
          <TouchableOpacity
            onPress={() => setViewing(null)}
            accessibilityRole="button"
            accessibilityLabel="Close the photo"
            style={[s.viewerClose, { top: insets.top + 12 }]}
          >
            <X size={22} color={D.white} />
          </TouchableOpacity>
          {viewing ? <FileImage uri={viewing} style={s.viewerImage} resizeMode="contain" /> : null}
        </View>
      </Modal>

      <CoachMarkTour tourId="booking-details" steps={DETAILS_TOUR} ready />
    </View>
  )
}

/* ── Pieces ───────────────────────────────────────────────────────────── */

/** How a pin on the route reads (Figma "Assignments Details" frames). */
type PinState = 'pickup' | 'done' | 'next' | 'ahead' | 'failed'

function pinState(status: string, isNext: boolean): PinState {
  if (status === 'delivered') return 'done'
  if (status === 'failed')    return 'failed'
  return isNext ? 'next' : 'ahead'
}

/** The office confirmed this stop for the driver, with no photo (backend: "Confirmed by the office: …"). */
function byOffice(photo: string | null | undefined, reason: string | null | undefined): boolean {
  return !photo && typeof reason === 'string' && /^Confirmed by the office/i.test(reason)
}

/** One route + cargo pair: the whole booking, or one trip of a multi-trip one. */
interface Section {
  key:        string
  trip:       Trip | null
  pickupDone: boolean
  stops: Array<{ key: string; label: string; address: string; state: PinState }>
  drops: Array<{
    key:    string
    label:  string
    items:  CargoItem[]
    visits: Array<{ trip: Trip; stop: TripStop }>
  }>
}

function Card({
  icon, title, meta, right, children,
}: {
  icon:      React.ReactNode
  title:     string
  meta?:     string | null
  /** Cyan tag on the right of the heading, e.g. "TRIP 1". */
  right?:    string | null
  children:  React.ReactNode
}) {
  return (
    <View style={s.card}>
      <View style={s.cardHead}>
        {icon}
        <Text style={s.cardTitle}>{title}</Text>
        {meta ? (
          <>
            <View style={s.metaDot} />
            <Text style={s.cardMeta}>{meta}</Text>
          </>
        ) : null}
        {right ? <Text style={s.cardRight}>{right}</Text> : null}
      </View>
      {children}
    </View>
  )
}

/** A dashed rule. Drawn as dashes because RN's dashed one-side border is unreliable on Android. */
function Dashes({ color = D.cardLine, style }: { color?: string; style?: object }) {
  return (
    <View style={[s.dashes, style]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {Array.from({ length: 60 }, (_, i) => (
        <View key={i} style={[s.dash, { backgroundColor: color }]} />
      ))}
    </View>
  )
}

/**
 * "TRIP 1 ▾" / "TRIPS ▾": which trip of a multi-trip booking the route and
 * cargo show. Each choice also says where that trip is (Not loaded, On the
 * road, Done), which the old per-trip pills used to say.
 */
function TripPicker({
  trips, value, onChange,
}: {
  trips:    Trip[]
  value:    string
  onChange: (v: string) => void
}) {
  const current = trips.find((t) => t.trip_id === value)
  const label   = value === 'all' || !current ? 'TRIPS' : `TRIP ${current.trip_number}`
  // The shared dropdown (Figma 2488:12478 is this very bar, "TRIP 1").
  return (
    <Dropdown
      value={value}
      onChange={onChange}
      label={label}
      accessibilityLabel="Choose which trip to show"
      options={[
        { value: 'all', label: 'All trips', note: `${trips.length} trips` },
        ...trips.map((t) => ({
          value: t.trip_id,
          label: `Trip ${t.trip_number}`,
          note:  t.status === 'completed' ? 'Done' : t.status === 'in_transit' ? 'On the road' : 'Not loaded',
        })),
      ]}
    />
  )
}

function Stop({
  state, label, address, last,
}: {
  state:   PinState
  label:   string
  address: string
  last:    boolean
}) {
  // Colour carries where the stop is in the driver's day: yellow pickup not
  // loaded yet, green behind them, orange the one they are heading to, grey
  // still ahead, red failed.
  const color = state === 'done'   ? D.green
              : state === 'failed' ? D.red
              : state === 'pickup' ? D.yellow
              : state === 'next'   ? D.orange
              : D.faint
  const fill  = state === 'done'   ? D.greenDim
              : state === 'failed' ? D.redDim
              : state === 'pickup' ? D.yellowDim
              : state === 'next'   ? D.orangeDim
              : 'rgba(129,129,129,0.19)'

  return (
    <View style={s.stopRow}>
      <View style={s.stopRail}>
        <View style={[s.pin, { backgroundColor: fill, borderColor: color }]}>
          {state === 'done'
            ? <MapPinCheck size={14} color={color} strokeWidth={2} />
            : <MapPin size={14} color={color} strokeWidth={2} />}
        </View>
        {!last && <View style={s.stopConnector} />}
      </View>
      <View style={s.stopBody}>
        <Text style={s.stopText} numberOfLines={2}>
          <Text style={{ color: D.faint }}>{label}: </Text>
          {address}
        </Text>
      </View>
    </View>
  )
}

/**
 * One drop-off's goods, boxed. Once the job is moving it folds to its first two
 * lines ("Show more details"); the proof under it (children) stays visible
 * either way, so the Upload button is never hidden behind the fold.
 */
function DropBox({
  label, items, flat, collapsible, expanded, onToggle, children,
}: {
  label:       string
  items:       CargoItem[]
  /** In transit / done: lines split by dashes rather than each in its own card. */
  flat:        boolean
  collapsible: boolean
  expanded:    boolean
  onToggle:    () => void
  children?:   React.ReactNode
}) {
  const LIMIT  = 2
  const folds  = collapsible && items.length > LIMIT
  const shown  = folds && !expanded ? items.slice(0, LIMIT) : items

  return (
    <View style={s.dropBox}>
      <Text style={s.dropTitle}>{label}</Text>
      {shown.map((c, i) => (
        <CargoBlock key={c.item_id} item={c} index={i} flat={flat} />
      ))}
      {children}
      {folds && (
        <TouchableOpacity
          onPress={onToggle}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityState={{ expanded }}
          accessibilityLabel={expanded ? 'See less details' : `Show more details, ${items.length - LIMIT} more cargo`}
          style={s.dropMore}
          hitSlop={8}
        >
          <Text style={s.dropMoreText}>{expanded ? 'SEE LESS DETAILS' : 'SHOW MORE DETAILS'}</Text>
          {expanded
            ? <ChevronUp size={12} color={D.yellow} strokeWidth={2.5} />
            : <ChevronDown size={12} color={D.yellow} strokeWidth={2.5} />}
        </TouchableOpacity>
      )}
    </View>
  )
}

/**
 * Proof of delivery for one drop-off, across every run that served it.
 *
 * This is the part of the screen the driver comes back for. A stop confirmed in
 * a dead zone is already recorded — the offline queue saw to that — but its
 * photo can still be missing, and until now there was no way to supply one: a
 * confirmed stop is idempotent, so re-confirming it does nothing.
 *
 * One row per VISIT, not per bay. A load too big for one run is delivered twice,
 * and each delivery has its own picture; collapsing them into a single "proof"
 * would quietly discard one of them.
 *
 *   owed     the stop, its photo, or both are missing → green Upload button
 *   sending  confirmed here, still in the offline queue → amber note
 *   settled  confirmed and evidenced → listed under DOCUMENTS (tap to view)
 */
function StopProofSection({
  visits, shuttle, label, uploading, sending, onUpload, onView,
}: {
  visits:    Array<{ trip: Trip; stop: TripStop }>
  shuttle:   boolean
  label:     string
  /** trip_stop_id currently uploading, if any. */
  uploading: string | null
  /** trip_stop_ids confirmed on this phone whose confirmation + photo are still being sent. */
  sending:   Set<string>
  onUpload:  (stop: TripStop, label: string) => void
  onView:    (url: string) => void
}) {
  if (visits.length === 0) return null

  const isSettled = (st: TripStop) =>
    (st.status === 'delivered' || st.status === 'failed') && !!st.proof_photo_url
  const inQueue = visits.filter((v) => sending.has(v.stop.trip_stop_id))
  const owed    = visits.filter((v) => !sending.has(v.stop.trip_stop_id) && !isSettled(v.stop))
  const docs    = visits.filter((v) => !sending.has(v.stop.trip_stop_id) && isSettled(v.stop))

  return (
    <View style={s.proofSection}>
      {inQueue.map(({ stop }) => (
        // Offering "upload" now would only be refused by the server.
        <View key={stop.trip_stop_id} style={s.proofSending}>
          <ActivityIndicator size="small" color={D.amber} />
          <Text style={[s.proofSendingText]} numberOfLines={2}>
            Sending the confirmation and photo — goes out as soon as there is signal
          </Text>
        </View>
      ))}

      {owed.map(({ trip, stop }) => {
        const busy = uploading === stop.trip_stop_id
        const done = stop.status === 'delivered' || stop.status === 'failed'
        return (
          <View key={stop.trip_stop_id} style={{ gap: 5 }}>
            <TouchableOpacity
              onPress={() => onUpload(stop, label)}
              disabled={busy}
              activeOpacity={0.85}
              accessibilityRole="button"
              accessibilityLabel={
                done
                  ? 'Upload the proof of delivery photo for this drop-off'
                  : 'Confirm this drop-off and upload its proof of delivery'
              }
              style={[s.proofBtn, busy && { opacity: 0.6 }]}
            >
              {busy
                ? <ActivityIndicator size="small" color={D.green} />
                : <ImageUp size={16} color={D.green} strokeWidth={2} />}
              <Text style={s.proofBtnText}>
                {busy ? 'Uploading…' : `Upload Proof of Delivery${shuttle && visits.length > 1 ? ` · Trip ${trip.trip_number}` : ''}`}
              </Text>
            </TouchableOpacity>
            {/* The stop is recorded and the client was told it arrived; only
                the paperwork is outstanding, so the driver needn't drive back. */}
            {done && !busy ? (
              <Text style={s.proofPending} numberOfLines={2}>
                {byOffice(stop.proof_photo_url, stop.proof_override_reason)
                  ? 'Recorded by the office, no photo. Add one if you took it.'
                  : 'Delivered — the photo never made it out. Upload it whenever you have signal.'}
              </Text>
            ) : null}
          </View>
        )
      })}

      {docs.length > 0 && (
        <View style={{ gap: 6 }}>
          <Text style={s.docsTitle}>DOCUMENTS</Text>
          {docs.map(({ trip, stop }) => (
            <TouchableOpacity
              key={stop.trip_stop_id}
              onPress={() => onView(stop.proof_photo_url!)}
              activeOpacity={0.75}
              accessibilityRole="button"
              accessibilityLabel="Open the proof of delivery photo"
              style={s.docRow}
            >
              <Text style={s.docText} numberOfLines={1}>
                Proof of delivery photo{shuttle ? ` · Trip ${trip.trip_number}` : ''}
              </Text>
              <Eye size={14} color={D.faint} strokeWidth={2} />
            </TouchableOpacity>
          ))}
        </View>
      )}
    </View>
  )
}

function CargoBlock({
  item, index, flat,
}: {
  item:  CargoItem
  index: number
  /** In transit / done: dashed split, no card. Before the start: each line its own card. */
  flat:  boolean
}) {
  const product   = pick(item.products, item.product_text)
  const commodity = pick(item.commodities, item.commodity_text)
  const shc       = codeLabel(item.shc,  item.shc_text)
  const ashc      = codeLabel(item.ashc, item.ashc_text)
  const dims      = dimensions(item)

  const rows = (
    <>
      <SpecRow flat={flat} label="Commodity"             value={commodity} />
      <SpecRow flat={flat} label="Special Handling Code" value={shc} />
      <SpecRow flat={flat} label="Additional SHC"        value={ashc} />
      <SpecRow flat={flat} label="Weight" value={item.weight_kg  != null ? `${item.weight_kg} kg`   : null} accent />
      <SpecRow flat={flat} label="Volume" value={item.volume_cbm != null ? `${item.volume_cbm} CBM` : null} accent />
      <SpecRow flat={flat} label="L × W × H" value={dims} accent />
    </>
  )

  if (flat) {
    return (
      <View style={{ marginTop: index > 0 ? 4 : 8 }}>
        {index > 0 && <Dashes style={{ marginBottom: 12 }} />}
        <Text style={s.cargoHeadingFlat}>CARGO {index + 1}</Text>
        <View style={s.cargoTopFlat}>
          <Text style={s.cargoProductFlat} numberOfLines={2}>{product ?? '—'}</Text>
          {item.quantity != null && (
            <Text style={s.cargoQtyFlat}>
              <Text style={{ color: D.white }}>Quantity: </Text>
              {item.quantity}
            </Text>
          )}
        </View>
        {rows}
      </View>
    )
  }

  return (
    <View style={s.cargoCard}>
      <Text style={s.cargoHeading}>CARGO {index + 1}</Text>
      <Text style={s.cargoLabel}>Product</Text>
      <View style={s.cargoTop}>
        <Text style={s.cargoProduct} numberOfLines={2}>{product ?? '—'}</Text>
        {item.quantity != null && (
          <Text style={s.cargoQty}>
            <Text style={s.cargoQtyLabel}>Quantity: </Text>
            {item.quantity}
          </Text>
        )}
      </View>
      {rows}
    </View>
  )
}

/** One label/value line in the cargo table. Skipped entirely when unset. */
function SpecRow({
  label, value, accent = false, flat,
}: {
  label:   string
  value:   string | null
  accent?: boolean
  flat:    boolean
}) {
  if (!value) return null
  return (
    <View style={flat ? s.specRowFlat : s.specRow}>
      <Text style={flat ? s.specLabelFlat : s.specLabel} numberOfLines={2}>{label}</Text>
      <Text style={[flat ? s.specValueFlat : s.specValue, accent && { color: D.cyan }]} numberOfLines={1}>{value}</Text>
    </View>
  )
}

/** "[label] … [time]" — a step time in Philippine time; "---" when not reached. */
type TimeRow = [label: string, iso: string | null | undefined, text?: string]

function stamp(iso: string): string {
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return '---'
  const d = new Date(t + 8 * 3600_000)
  const h = d.getUTCHours()
  return `${h % 12 || 12}:${String(d.getUTCMinutes()).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`
}

/** One stop visit in TRANSIT STOP TIMES (Figma): its four times, read only. */
function TimesBox({ title, rows }: { title: string; rows: TimeRow[] }) {
  return (
    <View style={s.timesBox}>
      <Text style={s.timesTitle}>{title}</Text>
      <View style={s.timesInner}>
        {rows.map(([label, iso, text], i) => (
          <View key={label} style={[s.timesRow, i === rows.length - 1 && { borderBottomWidth: 0 }]}>
            <Text style={s.timesLabel}>{label}</Text>
            <Text style={[s.timesValue, !iso && !text && { color: D.faint }]}>
              {text ?? (iso ? stamp(iso) : '---')}
            </Text>
          </View>
        ))}
      </View>
    </View>
  )
}

const s = StyleSheet.create({
  /* ── Proof / documents under a drop-off ── */
  proofSection: {
    marginTop: 12,
    gap:       8,
  },
  proofBtn: {
    flexDirection:   'row',
    alignItems:      'center',
    justifyContent:  'center',
    gap:             8,
    minHeight:       38,
    paddingHorizontal: 10,
    borderRadius:    10,
    borderWidth:     1,
    borderColor:     D.green,
    backgroundColor: D.greenDim,
  },
  proofBtnText: {
    color:      D.green,
    fontSize:   14,
    fontFamily: FONTS.spartan.bold,
    flexShrink: 1,
  },
  proofSending: {
    flexDirection:   'row',
    alignItems:      'center',
    gap:             8,
    minHeight:       38,
    paddingHorizontal: 12,
    borderRadius:    10,
    borderWidth:     1,
    borderColor:     'rgba(255,122,48,0.35)',
    backgroundColor: D.amberBg,
  },
  proofSendingText: {
    color:      D.amber,
    fontSize:   12,
    flex:       1,
    fontFamily: FONTS.spartan.medium,
  },
  proofPending: {
    color:      D.amber,
    fontSize:   11,
    lineHeight: 16,
    fontFamily: FONTS.spartan.medium,
  },
  docsTitle: {
    color:         D.cyan,
    fontSize:      12,
    letterSpacing: 0.3,
    fontFamily:    FONTS.spartan.bold,
  },
  docRow: {
    flexDirection:   'row',
    alignItems:      'center',
    gap:             8,
    minHeight:       34,
    paddingHorizontal: 10,
    borderRadius:    8,
    backgroundColor: '#2b2b2b',
  },
  docText: {
    flex:       1,
    color:      D.faint,
    fontSize:   12,
    fontFamily: FONTS.spartan.medium,
  },
  uploadError: {
    color:      D.red,
    fontSize:   12,
    lineHeight: 17,
    marginTop:  10,
    fontFamily: FONTS.spartan.medium,
  },

  dashes: {
    flexDirection: 'row',
    overflow:      'hidden',
    gap:           4,
    height:        1,
  },
  dash: {
    width:  5,
    height: 1,
  },

  /* ── Transit stop times ── */
  timesTrip: {
    color:         D.white,
    fontSize:      12,
    letterSpacing: 0.4,
    fontFamily:    FONTS.spartan.bold,
  },
  timesBox: {
    backgroundColor: D.inner,
    borderRadius:    10,
    padding:         8,
    gap:             6,
  },
  timesTitle: {
    color:         D.cyan,
    fontSize:      12,
    letterSpacing: 0.3,
    fontFamily:    FONTS.spartan.bold,
  },
  timesInner: {
    backgroundColor:   '#2b2b2b',
    borderRadius:      8,
    paddingHorizontal: 10,
    paddingVertical:   2,
  },
  timesRow: {
    flexDirection:     'row',
    alignItems:        'center',
    justifyContent:    'space-between',
    gap:               10,
    paddingVertical:   5,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.18)',
  },
  timesLabel: {
    color:      D.faint,
    fontSize:   12,
    flexShrink: 1,
  },
  timesValue: {
    color:    D.white,
    fontSize: 12,
  },

  pageMore: {
    flexDirection: 'row',
    alignItems:    'center',
    alignSelf:     'flex-start',
    gap:           6,
    paddingVertical: 4,
  },
  pageMoreText: {
    color:         D.cyan,
    fontSize:      12,
    letterSpacing: 0.3,
    fontFamily:    FONTS.spartan.bold,
  },

  doneNote: {
    flexDirection:   'row',
    alignItems:      'center',
    gap:             8,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius:    10,
    borderWidth:     1,
    borderColor:     D.cardLine,
    backgroundColor: D.card,
  },
  transferCard: {
    gap:             8,
    padding:         14,
    borderRadius:    10,
    borderWidth:     1,
    borderColor:     D.amber,
    backgroundColor: D.card,
  },
  transferTitle: {
    color:      D.white,
    fontSize:   14,
    fontWeight: '700',
  },
  doneNoteText: {
    color:      D.faint,
    fontSize:   13,
    flex:       1,
    lineHeight: 18,
    fontFamily: FONTS.spartan.medium,
  },

  root: {
    flex:            1,
    backgroundColor: D.bg,
  },

  centered: {
    flex:            1,
    alignItems:      'center',
    justifyContent:  'center',
    backgroundColor: D.bg,
    gap:             12,
  },
  centeredText: {
    color:    D.faint,
    fontSize: 14,
  },
  errorText: {
    color:      D.red,
    fontSize:   14,
    textAlign:  'center',
    lineHeight: 22,
  },
  retryBtn: {
    marginTop:         12,
    paddingVertical:   10,
    paddingHorizontal: 28,
    borderRadius:      14,
    backgroundColor:   D.card,
    borderWidth:       1,
    borderColor:       D.cardLine,
  },
  retryText: {
    color:      D.cyan,
    fontSize:   14,
    fontWeight: '700',
  },

  header: {
    flexDirection:     'row',
    alignItems:        'flex-start',
    gap:               11,
    paddingHorizontal: 19,
    paddingBottom:     20,
  },
  // 35px circle on the card surface, as the design's back btn draws it.
  backBtn: {
    width:           35,
    height:          35,
    borderRadius:    17.5,
    backgroundColor: D.card,
    borderWidth:     0.5,
    borderColor:     D.cardLine,
    alignItems:      'center',
    justifyContent:  'center',
  },
  headerText: {
    flex:       1,
    paddingTop: 1,
  },
  ref: {
    color:      D.white,
    fontSize:   22,
    fontFamily: FONTS.spartan.medium,
  },
  schedule: {
    color:     D.cyan,
    fontSize:  11,
    marginTop: 4,
  },
  // Top right of the header, sized to its label.

  card: {
    backgroundColor: D.card,
    borderRadius:    15,
    borderWidth:     0.5,
    borderColor:     D.cardLine,
    padding:         15.5,
  },
  cardHead: {
    flexDirection: 'row',
    alignItems:    'center',
    gap:           4,
  },
  cardTitle: {
    color:      D.white,
    fontSize:   14,
    fontFamily: FONTS.spartan.medium,
  },
  metaDot: {
    width:           4,
    height:          4,
    borderRadius:    2,
    backgroundColor: D.faint,
    marginHorizontal: 3,
  },
  cardMeta: {
    color:      D.faint,
    fontSize:   14,
    flexShrink: 1,
  },
  cardRight: {
    marginLeft:    'auto',
    color:         D.cyan,
    fontSize:      12,
    letterSpacing: 0.4,
    fontFamily:    FONTS.spartan.bold,
  },

  company: {
    color:      D.white,
    fontSize:   25,
    marginTop:  12,
    fontFamily: FONTS.spartan.bold,
  },
  clientLine: {
    color:     D.faint,
    fontSize:  14,
    marginTop: 5,
  },

  innerBox: {
    backgroundColor: D.inner,
    borderRadius:    10,
    padding:         12,
    marginTop:       12,
  },

  stopRow: {
    flexDirection: 'row',
    gap:           7,
  },
  stopRail: {
    alignItems: 'center',
  },
  pin: {
    width:          24,
    height:         24,
    borderRadius:   12,
    borderWidth:    0.5,
    alignItems:     'center',
    justifyContent: 'center',
  },
  stopConnector: {
    width:           1,
    height:          12,
    marginVertical:  1,
    backgroundColor: D.faint,
  },
  stopText: {
    flex:       1,
    color:      D.white,
    fontSize:   12,
    lineHeight: 16,
    paddingTop: 4,
  },
  stopBody: {
    flex: 1,
  },

  /* ── Cargo ── */
  dropBox: {
    backgroundColor: D.inner,
    borderRadius:    10,
    padding:         8,
    paddingBottom:   10,
  },
  dropTitle: {
    color:         D.white,
    fontSize:      13,
    letterSpacing: 0.3,
    fontFamily:    FONTS.spartan.bold,
  },
  dropMore: {
    flexDirection:  'row',
    alignItems:     'center',
    justifyContent: 'center',
    gap:            4,
    marginTop:      12,
  },
  dropMoreText: {
    color:         D.yellow,
    fontSize:      10,
    letterSpacing: 0.3,
    fontFamily:    FONTS.spartan.bold,
  },

  // Before the start: each line in its own card.
  cargoCard: {
    backgroundColor: '#2b2b2b',
    borderRadius:    8,
    padding:         10,
    marginTop:       8,
  },
  cargoHeading: {
    color:        D.cyan,
    fontSize:     12,
    marginBottom: 10,
    fontFamily:   FONTS.spartan.medium,
  },
  cargoLabel: {
    color:    D.faint,
    fontSize: 10,
  },
  cargoTop: {
    flexDirection:     'row',
    alignItems:        'flex-end',
    justifyContent:    'space-between',
    gap:               12,
    paddingBottom:     3,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.35)',
  },
  cargoProduct: {
    flex:       1,
    color:      D.cyan,
    fontSize:   12,
    fontWeight: '700',
  },
  cargoQty: {
    color:      D.cyan,
    fontSize:   12,
    fontWeight: '700',
    textAlign:  'right',
  },
  cargoQtyLabel: {
    color:      D.faint,
    fontWeight: '400',
  },
  specRow: {
    flexDirection:     'row',
    alignItems:        'center',
    justifyContent:    'space-between',
    gap:               12,
    paddingVertical:   4,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.35)',
  },
  specLabel: {
    color:      D.faint,
    fontSize:   12,
    flexShrink: 1,
  },
  specValue: {
    color:     D.white,
    fontSize:  12,
    textAlign: 'right',
  },

  // In transit / done: lines split by dashes, labels bold.
  cargoHeadingFlat: {
    color:        D.cyan,
    fontSize:     12,
    marginBottom: 10,
    fontFamily:   FONTS.spartan.bold,
  },
  cargoTopFlat: {
    flexDirection:  'row',
    alignItems:     'flex-start',
    justifyContent: 'space-between',
    gap:            12,
    paddingBottom:  2,
  },
  cargoProductFlat: {
    flex:       1,
    color:      D.cyan,
    fontSize:   12,
    fontFamily: FONTS.spartan.bold,
  },
  cargoQtyFlat: {
    color:      D.cyan,
    fontSize:   12,
    fontFamily: FONTS.spartan.bold,
    textAlign:  'right',
  },
  specRowFlat: {
    flexDirection:   'row',
    alignItems:      'center',
    justifyContent:  'space-between',
    gap:             12,
    paddingVertical: 2,
  },
  specLabelFlat: {
    color:      D.faint,
    fontSize:   12,
    flexShrink: 1,
    fontFamily: FONTS.spartan.bold,
  },
  specValueFlat: {
    color:      D.white,
    fontSize:   12,
    textAlign:  'right',
    fontFamily: FONTS.spartan.bold,
  },

  vehicle: {
    fontSize:  14,
    marginTop: 12,
  },

  dock: {
    position:          'absolute',
    left:              0,
    right:             0,
    bottom:            0,
    paddingHorizontal: 19,
    paddingTop:        12,
    // One even space between everything in the bar (cards, banners, buttons).
    gap:               10,
    backgroundColor:   D.bg,
    borderTopWidth:    StyleSheet.hairlineWidth,
    borderTopColor:    D.divider,
  },
  offlineBanner: {
    flexDirection:     'row',
    alignItems:        'center',
    gap:               8,
    paddingVertical:   9,
    paddingHorizontal: 12,
    borderRadius:      12,
    backgroundColor:   D.amberBg,
    borderWidth:       1,
    borderColor:       'rgba(255,122,48,0.35)',
  },
  offlineText: {
    color:      D.amber,
    fontSize:   12,
    fontWeight: '600',
    flex:       1,
  },
  startBtn: {
    height:          46,
    flexDirection:   'row',
    alignItems:      'center',
    justifyContent:  'center',
    gap:             9,
    borderRadius:    10,
    backgroundColor: D.cyanDim,
    borderWidth:     1,
    borderColor:     D.cyan,
  },
  startText: {
    color:      D.cyan,
    fontSize:   16,
    fontFamily: FONTS.spartan.bold,
  },
  // Locked reads as inert rather than broken: same shape, no cyan.
  startBtnLocked: {
    backgroundColor: 'transparent',
    borderColor:     D.cardLine,
  },

  lockNote: {
    flexDirection:  'row',
    alignItems:     'center',
    gap:            7,
    justifyContent: 'center',
  },
  lockText: {
    color:    D.faint,
    fontSize: 12,
  },

  // Figma pending frame: outlined, grey, same size as the start button.
  previewRouteBtn: {
    height:          46,
    flexDirection:   'row',
    alignItems:      'center',
    justifyContent:  'center',
    gap:             9,
    borderRadius:    10,
    borderWidth:     1,
    borderColor:     'rgba(255,255,255,0.45)',
    backgroundColor: 'transparent',
  },
  previewRouteText: {
    color:      D.faint,
    fontSize:   16,
    fontFamily: FONTS.spartan.bold,
  },
  previewBtn: {
    height:         44,
    flexDirection:  'row',
    alignItems:     'center',
    justifyContent: 'center',
    gap:            8,
    borderRadius:   10,
    borderWidth:    0.5,
    borderColor:    D.cardLine,
    backgroundColor: D.card,
  },
  previewText: {
    color:      D.white,
    fontSize:   14,
    fontWeight: '600',
  },

  viewer: {
    flex:            1,
    backgroundColor: 'rgba(0,0,0,0.95)',
    alignItems:      'center',
    justifyContent:  'center',
  },
  viewerClose: {
    position:        'absolute',
    right:           16,
    zIndex:          2,
    width:           40,
    height:          40,
    borderRadius:    20,
    alignItems:      'center',
    justifyContent:  'center',
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  viewerImage: {
    width:  '100%',
    height: '80%',
  },
})

/** "Pedro's phone is navigating. Take over?" Resolves true on Take over. */
function askTakeOver(state: NavigatorState): Promise<boolean> {
  const who = state.driver_name || 'The other driver'
  return new Promise((resolve) => {
    appAlert(
      `${who}’s phone is navigating`,
      `Only one phone navigates at a time. ${who}’s phone was ${heardAgo(state.last_heard_at)}. ` +
      `Take over navigation on this phone? ${who}’s phone will stop guiding.`,
      [
        { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
        { text: 'Take over', onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    )
  })
}

/**
 * BLOWBAGETS Self, the driver's own fitness before driving (user 2026-11-28).
 * Resolves 'fit', 'unfit', or null when the question was closed without an answer.
 */
function askSelfCheck(): Promise<'fit' | 'unfit' | null> {
  return new Promise((resolve) => {
    appAlert(
      'Self check (BLOWBAGETS)',
      'Before you drive: are you rested, not sick, free of alcohol and drugs, and carrying your driver’s license?',
      [
        { text: 'Not fit to drive', style: 'destructive', onPress: () => resolve('unfit') },
        { text: 'I’m fit to drive', onPress: () => resolve('fit') },
      ],
      { cancelable: true, onDismiss: () => resolve(null) },
    )
  })
}
