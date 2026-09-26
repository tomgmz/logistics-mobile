import React, { useCallback, useEffect, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import NetInfo from '@react-native-community/netinfo'
import {
  AlertCircle,
  Boxes,
  Camera,
  Check,
  ChevronLeft,
  Eye,
  FileText,
  Lock,
  MapPin,
  Navigation,
  PackageCheck,
  Road,
  Truck,
  User,
  Warehouse,
  WifiOff,
} from 'lucide-react-native'

import api from '../../../lib/api/auth.api'
import { saveBookingCache, loadBookingCache } from '../../../lib/navCache'
import { bookingRef } from '../../../lib/driverBookings'
import { navigationGate, formatGateDate } from '../../../lib/deliveryWindow'
import { syncServerTime } from '../../../lib/serverTime'
import { FONTS } from '../../../lib/config/fonts'
import { groupCargoByDestination, manifestFor } from '../../../lib/cargoManifest'
import {
  fetchTripsWithCache,
  isMultiTrip,
  tripProgressCounts,
  type Trip,
  type TripStop,
} from '../../../lib/trips'
import {
  confirmTripStop,
  completeBooking,
  confirmFleetReturn,
  type StopProofContext,
} from '../../../lib/tripProgress'
import { attachStopProof } from '../../../lib/api/stopProof.api'
import { StopProofModal } from './StopProofModal'
import { ConfirmDialog } from '../../ui/ConfirmDialog'
import { captureProofPhoto, CameraPermissionError, uploadProofPhoto } from '../../../lib/proofPhoto'

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
  truck_type_needed: string
  clients?: {
    company_name?: string | null
    users?: { first_name?: string; last_name?: string; phone?: string | null } | null
  } | null
  booking_destinations?: Destination[]
  booking_cargo_items?:  CargoItem[]
  truck_assignments?: Array<{
    trucks?: { plate_number?: string; truck_models?: { name?: string; vehicle_type?: string } | null } | null
  }>
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
  amber:    '#f59e0b',
  amberBg:  '#1a1200',
}

/** The tag beside the booking ref, one per state of the job. */
const STATUS_TAG: Record<string, { label: string; color: string; bg: string }> = {
  pending:    { label: 'PENDING',    color: D.yellow,  bg: D.yellowDim             },
  assigned:   { label: 'ASSIGNED',   color: D.cyan,    bg: D.cyanDim               },
  in_transit: { label: 'IN TRANSIT', color: D.cyan,    bg: D.cyanDim               },
  completed:  { label: 'COMPLETED',  color: D.green,   bg: D.greenDim              },
  cancelled:  { label: 'CANCELLED',  color: D.red,     bg: D.redDim                },
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

function dimensions(c: CargoItem): string | null {
  const { length_cm: l, width_cm: w, height_cm: h } = c
  if (l == null || w == null || h == null) return null
  return `${l} × ${w} × ${h} cm`
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

  // Which end-of-job confirmation is open, if any.
  const [dialog, setDialog] = useState<'complete' | 'return' | null>(null)
  const [dialogBusy, setDialogBusy] = useState(false)
  // Set locally the moment the driver confirms, so the button settles
  // immediately instead of waiting on a refetch that may be offline.
  const [returned, setReturned] = useState(false)
  const [finished, setFinished] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
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
      const { data } = await api.get(`/booking/${bookingId}`)
      setBooking(data.data)
      setFromCache(false)
      // Keep a copy so navigation can still derive its stops if the network
      // drops before/at start.
      saveBookingCache(bookingId, data.data)
    } catch (e: any) {
      // Network failed — fall back to the last cached copy if we have one, so
      // the driver still sees the job details instead of a dead end.
      const cached = await loadBookingCache<Booking>(bookingId)
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
    const unsub = NetInfo.addEventListener((s) => setOffline(!s.isConnected))
    return () => unsub()
  }, [])

  const gate = navigationGate(booking)

  /** The offline caveat, asked last so it wraps whichever start we're doing. */
  const startWithOfflineCheck = useCallback((earlyStart: boolean) => {
    if (offline) {
      Alert.alert(
        'You’re offline',
        'A new route can’t be started without a connection — the map provider needs network to build it. ' +
        'If this trip is already in progress, guidance will keep running on the route it already loaded.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Try anyway', style: 'default', onPress: () => onStart(earlyStart) },
        ],
      )
      return
    }
    onStart(earlyStart)
  }, [offline, onStart])

  const handleStart = useCallback(() => {
    // Locked because the booking isn't the driver's to run at all — not
    // something an override should be able to talk its way past.
    if (gate.reason === 'cancelled') {
      Alert.alert('Booking cancelled', 'This booking has been cancelled and can’t be delivered.')
      return
    }

    if (gate.reason === 'not_assigned') {
      Alert.alert(
        'Not ready to start',
        'This booking hasn’t been assigned for delivery yet. It will open once the Operations Manager releases it.',
      )
      return
    }

    // Scheduled for a later day. Startable, but the driver has to mean it, and
    // the choice is recorded against the pickup.
    if (gate.reason === 'not_yet' && gate.scheduledFor) {
      Alert.alert(
        'Not scheduled until ' + formatGateDate(gate.scheduledFor),
        'Starting now records a pickup ahead of the scheduled day, and that gets flagged on the booking. ' +
        'Only do this if the job really has moved up.',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Start early',
            style: 'destructive',
            onPress: () => startWithOfflineCheck(true),
          },
        ],
      )
      return
    }

    startWithOfflineCheck(false)
  }, [gate.reason, gate.scheduledFor, startWithOfflineCheck])

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
      setProofFor({ stop, label, mode: 'confirm' })
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
      const url = await uploadProofPhoto(uri)
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

  /** The full confirm-a-stop flow, from the modal. */
  const confirmStop = useCallback((photoUri: string, proof: StopProofContext) => {
    const target = proofFor
    setProofFor(null)
    if (!target) return

    // Durable: this goes through the offline queue exactly as a confirmation
    // from the navigation map does, so a stop confirmed here with no signal is
    // still sent when one returns.
    confirmTripStop(target.stop.trip_stop_id, photoUri, proof, null).catch(() => {})

    setTrips((prev) => prev.map((t) => ({
      ...t,
      booking_trip_stops: (t.booking_trip_stops ?? []).map((x) =>
        x.trip_stop_id === target.stop.trip_stop_id
          ? { ...x, status: 'delivered' as const, delivered_at: new Date().toISOString() }
          : x,
      ),
    })))
  }, [proofFor])

  /* ── Closing the job out ────────────────────────────────────────────────── */

  const onCompleteConfirmed = useCallback(async () => {
    setDialogBusy(true)
    try {
      await completeBooking(bookingId)
      setFinished(true)
    } catch { /* queued; the driver is not blocked on the network */ }
    setDialogBusy(false)
    setDialog(null)
  }, [bookingId])

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

  const tag       = STATUS_TAG[booking.status] ?? STATUS_TAG.assigned
  const totalQty  = cargo.reduce((n, c) => n + (c.quantity ?? 0), 0)
  const itemsMeta = totalQty > 0 ? `${totalQty} ITEM${totalQty === 1 ? '' : 'S'}` : null

  /* ── Which face of this screen the driver is looking at ─────────────────── */

  const isDone     = finished || booking.status === 'completed'
  const inTransit  = !isDone && booking.status === 'in_transit'
  const hasReturned = returned || !!booking.fleet_return_at

  const shuttle = isMultiTrip(trips)
  const counts  = tripProgressCounts(trips)

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

  const cargoByStop = dropoffs.map((d, i) => ({
    destination: d,
    label:       `DROP-OFF ${i + 1}`,
    manifest:    manifestFor(grouped, d.destination_id),
  }))

  return (
    <View style={s.root}>
      <StatusBar barStyle="light-content" backgroundColor="transparent" translucent />

      {/* Header — back, ref + schedule, status tag */}
      <View style={[s.header, { paddingTop: insets.top + 8 }]}>
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
          <Text style={s.schedule} numberOfLines={1}>
            {fmtDate(booking.schedule_date)}
            {booking.call_time ? ` · ${fmtTime(booking.call_time)}` : ''}
          </Text>
        </View>

        <View style={[s.tag, { backgroundColor: tag.bg, borderColor: tag.color }]}>
          <View style={[s.tagDot, { backgroundColor: tag.color }]} />
          <Text style={[s.tagText, { color: tag.color }]}>{tag.label}</Text>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: 24,
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

        {/* Route.

            On a shuttle this is grouped by RUN, because that is the shape of the
            driver's day: back to the origin, load, out again. A flat list of
            bays would read as one continuous drive and hide the reloads, which
            are most of the work. A single-run booking gets the plain list — it
            is what it has always been, and labelling it "TRIP 1 OF 1" would be
            ceremony around a fact the driver already knows. */}
        <Card
          icon={<Road size={16} color={D.cyan} />}
          title="ROUTE"
          meta={
            shuttle
              ? `${counts.runsTotal} TRIPS · ${dropoffs.length} DROP-OFF${dropoffs.length === 1 ? '' : 'S'}`
              : `${dropoffs.length} DROP-OFF${dropoffs.length === 1 ? '' : 'S'}`
          }
        >
          {shuttle && (
            <Text style={s.shuttleNote}>
              One vehicle, {counts.runsTotal} trips — it returns to the pickup point to reload between each.
            </Text>
          )}

          {shuttle ? (
            trips
              .filter((t) => t.status !== 'cancelled')
              .map((trip) => {
                const stops = [...(trip.booking_trip_stops ?? [])]
                  .sort((a, b) => a.sequence_order - b.sequence_order)
                const loaded = trip.status !== 'pending'

                return (
                  <View key={trip.trip_id} style={s.tripGroup}>
                    <View style={s.tripHead}>
                      <Text style={s.tripTitle}>TRIP {trip.trip_number}</Text>
                      <View style={[
                        s.tripPill,
                        trip.status === 'completed' && { borderColor: D.green,  backgroundColor: D.greenDim },
                        trip.status === 'in_transit' && { borderColor: D.cyan,   backgroundColor: D.cyanDim  },
                      ]}>
                        <Text style={[
                          s.tripPillText,
                          trip.status === 'completed' && { color: D.green },
                          trip.status === 'in_transit' && { color: D.cyan  },
                        ]}>
                          {trip.status === 'completed' ? 'DONE'
                            : trip.status === 'in_transit' ? 'OUT NOW'
                            : 'NOT LOADED'}
                        </Text>
                      </View>
                    </View>

                    <View style={s.innerBox}>
                      {/* The origin is a stop on EVERY run — the truck comes back
                          for the next load — so it is drawn on each one. */}
                      <Stop
                        tone="pickup"
                        label={`Load ${trip.trip_number}`}
                        address={booking.origin}
                        done={loaded}
                        last={stops.length === 0}
                      />
                      {stops.map((stop, i) => (
                        <Stop
                          key={stop.trip_stop_id}
                          tone="dropoff"
                          label={stop.booking_destinations
                            ? `Drop-off ${stop.booking_destinations.sequence_order}`
                            : `Drop-off ${i + 1}`}
                          address={stop.booking_destinations?.address ?? '—'}
                          done={stop.status === 'delivered'}
                          failed={stop.status === 'failed'}
                          last={i === stops.length - 1}
                        />
                      ))}
                    </View>
                  </View>
                )
              })
          ) : (
            <View style={s.innerBox}>
              <Stop
                tone="pickup"
                label="Pickup"
                address={booking.origin}
                done={inTransit || isDone}
                last={dropoffs.length === 0}
              />
              {dropoffs.map((d, i) => {
                const m = cargoByStop[i]?.manifest
                return (
                  <Stop
                    key={d.destination_id}
                    tone="dropoff"
                    label={`Drop-off ${i + 1}`}
                    address={d.address}
                    done={d.status === 'delivered'}
                    failed={d.status === 'failed'}
                    // What actually comes off here, at a glance, on the route list.
                    note={m && m.totalQty > 0 ? `${m.totalQty} item${m.totalQty === 1 ? '' : 's'} for this stop` : null}
                    last={i === dropoffs.length - 1}
                  />
                )
              })}
            </View>
          )}
        </Card>

        {/* Cargo, grouped by the stop it comes off at — and, once the job is
            moving, the proof for that stop sitting directly under it. Putting
            the upload beside the manifest rather than in a section of its own is
            deliberate: the driver is answering "did THIS come off HERE", and
            the answer and the evidence should not be in two different places. */}
        {cargo.length > 0 && (
          <Card icon={<Boxes size={16} color={D.cyan} />} title="CARGO" meta={itemsMeta}>
            {cargoByStop.map(({ destination, label, manifest }) => (
              <View key={destination.destination_id}>
                {manifest.items.map((c, i) => (
                  <CargoBlock
                    key={c.item_id}
                    item={c}
                    index={i}
                    dropoffLabel={label}
                    // Repeat the stop's address on its first line so the driver
                    // reads WHERE before WHAT.
                    dropoffAddress={i === 0 ? destination.address : null}
                  />
                ))}

                {(inTransit || isDone) && (
                  <StopProofSection
                    visits={visitsByDestination.get(destination.destination_id) ?? []}
                    shuttle={shuttle}
                    label={label}
                    uploading={uploading}
                    onUpload={openProof}
                  />
                )}
              </View>
            ))}
            {grouped.unassigned.items.map((c, i) => (
              <CargoBlock
                key={c.item_id}
                item={c}
                index={i}
                dropoffLabel="WHOLE TRIP"
                dropoffAddress={null}
              />
            ))}
            {uploadError ? <Text style={s.uploadError}>{uploadError}</Text> : null}
          </Card>
        )}

        {/* Vehicle */}
        <Card icon={<Truck size={16} color={D.cyan} />} title="VEHICLE">
          <Text style={s.vehicle} numberOfLines={1}>
            {plate ? <Text style={{ color: D.cyan }}>{plate} </Text> : null}
            <Text style={{ color: plate ? D.faint : D.cyan }}>{truckModel}</Text>
          </Text>
        </Card>
      </ScrollView>

      {/* Start navigation */}
      <View
        style={[s.dock, { paddingBottom: insets.bottom + 14 }]}
        onLayout={(e) => {
          const h = Math.round(e.nativeEvent.layout.height)
          setDockH((prev) => (prev === h ? prev : h))
        }}
      >
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
        {gate.locked && !inTransit && !isDone && (
          <View style={s.lockNote}>
            <Lock size={13} color={D.faint} />
            <Text style={s.lockText}>
              {gate.reason === 'cancelled'
                ? 'This booking has been cancelled.'
                : gate.reason === 'not_assigned'
                  ? 'Waiting on the Operations Manager to release this booking.'
                  : `Navigation opens ${gate.scheduledFor ? formatGateDate(gate.scheduledFor) : 'on the scheduled day'}.`}
            </Text>
          </View>
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
        ) : inTransit ? (
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
        ) : (
          <TouchableOpacity
            activeOpacity={0.85}
            onPress={handleStart}
            accessibilityRole="button"
            accessibilityLabel={gate.locked ? 'Navigation locked until the scheduled day' : 'Start navigation'}
            style={[s.startBtn, gate.locked && s.startBtnLocked]}
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
        {inTransit && (
          <TouchableOpacity
            activeOpacity={0.75}
            onPress={() => startWithOfflineCheck(false)}
            accessibilityRole="button"
            accessibilityLabel="Resume navigation for this delivery"
            style={s.previewBtn}
          >
            <Navigation size={16} color={D.white} strokeWidth={2} />
            <Text style={s.previewText}>Resume navigation</Text>
          </TouchableOpacity>
        )}

        {/* Always available: seeing the run is never gated, only running it. */}
        {onPreview && !isDone && !inTransit && (
          <TouchableOpacity
            activeOpacity={0.75}
            onPress={onPreview}
            accessibilityRole="button"
            accessibilityLabel="Preview the route on a map, view only"
            style={s.previewBtn}
          >
            <Eye size={16} color={D.white} strokeWidth={2} />
            <Text style={s.previewText}>Preview route</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Confirming a stop from here rather than from the map: same modal, so a
          stop confirmed in the yard carries the same photo AND position as one
          confirmed on the road. */}
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
        manifest={proofFor ? manifestFor(grouped, proofFor.stop.destination_id) : null}
        onConfirm={confirmStop}
        onCancel={() => setProofFor(null)}
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
    </View>
  )
}

/* ── Pieces ───────────────────────────────────────────────────────────── */

function Card({
  icon, title, meta, children,
}: {
  icon:      React.ReactNode
  title:     string
  meta?:     string | null
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
      </View>
      {children}
    </View>
  )
}

function Stop({
  tone, label, address, note, last, done = false, failed = false,
}: {
  tone:    'pickup' | 'dropoff'
  label:   string
  address: string
  /** What comes off here, e.g. "3 items for this stop". */
  note?:   string | null
  last:    boolean
  /** Confirmed. Turns the pin green with a tick, as in the design. */
  done?:   boolean
  failed?: boolean
}) {
  // Colour carries the state, not the kind of stop: green once it is behind the
  // driver, amber while it is still ahead of them. On a shuttle the same pickup
  // point is drawn several times in different states, so a pin whose colour said
  // only "this is a pickup" would tell the driver nothing about their day.
  const color = done   ? D.green
              : failed ? D.red
              : tone === 'pickup' ? D.orange : D.orange
  const fill  = done   ? D.greenDim
              : failed ? D.redDim
              : D.orangeDim

  return (
    <View style={s.stopRow}>
      <View style={s.stopRail}>
        <View style={[s.pin, { backgroundColor: fill, borderColor: color }]}>
          {done
            ? <Check size={14} color={color} strokeWidth={3} />
            : <MapPin size={14} color={color} strokeWidth={2} />}
        </View>
        {!last && <View style={s.stopConnector} />}
      </View>
      <View style={s.stopBody}>
        <Text style={s.stopText} numberOfLines={2}>
          <Text style={{ color: D.faint }}>{label}: </Text>
          {address}
        </Text>
        {note ? <Text style={s.stopNote} numberOfLines={1}>{note}</Text> : null}
      </View>
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
 * The button says the same thing in all three of its states, because to the
 * driver it is the same job — the difference is only whether anything is still
 * owed:
 *   green  something is missing (the stop, its photo, or both)
 *   grey   nothing is owed; the row shows the document instead
 */
function StopProofSection({
  visits, shuttle, label, uploading, onUpload,
}: {
  visits:    Array<{ trip: Trip; stop: TripStop }>
  shuttle:   boolean
  label:     string
  /** trip_stop_id currently uploading, if any. */
  uploading: string | null
  onUpload:  (stop: TripStop, label: string) => void
}) {
  if (visits.length === 0) return null

  return (
    <View style={s.proofSection}>
      <View style={s.proofHead}>
        <FileText size={13} color={D.faint} />
        <Text style={s.proofTitle}>DOCUMENTS</Text>
      </View>

      {visits.map(({ trip, stop }) => {
        const busy    = uploading === stop.trip_stop_id
        const hasPhoto = !!stop.proof_photo_url
        const done     = stop.status === 'delivered' || stop.status === 'failed'
        // Nothing owed only when the drop is confirmed AND evidenced.
        const settled  = done && hasPhoto

        return (
          <View key={stop.trip_stop_id} style={s.proofRow}>
            {shuttle && (
              <Text style={s.proofTripTag}>TRIP {trip.trip_number}</Text>
            )}

            {settled ? (
              <View style={s.proofDone}>
                <PackageCheck size={15} color={D.green} strokeWidth={2} />
                <Text style={s.proofDoneText} numberOfLines={1}>
                  Proof of delivery uploaded
                </Text>
              </View>
            ) : (
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
                  : <Camera size={16} color={D.green} strokeWidth={2} />}
                <Text style={s.proofBtnText}>
                  {busy ? 'Uploading…' : 'Upload Proof of Delivery'}
                </Text>
              </TouchableOpacity>
            )}

            {/* Said plainly rather than left to the button's colour: the stop is
                recorded and the client has been told it arrived — it is only the
                paperwork that is outstanding, and a driver should not think they
                still have to drive back. */}
            {done && !hasPhoto && !busy ? (
              <Text style={s.proofPending} numberOfLines={2}>
                Delivered — the photo never made it out. Upload it whenever you have signal.
              </Text>
            ) : null}
          </View>
        )
      })}
    </View>
  )
}

function CargoBlock({
  item, index, dropoffLabel, dropoffAddress,
}: {
  item:            CargoItem
  index:           number
  dropoffLabel:    string | null
  /** Shown once per stop, above its first cargo block. */
  dropoffAddress?: string | null
}) {
  const product   = pick(item.products, item.product_text)
  const commodity = pick(item.commodities, item.commodity_text)
  const shc       = codeLabel(item.shc,  item.shc_text)
  const ashc      = codeLabel(item.ashc, item.ashc_text)
  const dims      = dimensions(item)

  return (
    <View style={index > 0 ? { marginTop: 14 } : undefined}>
      {dropoffAddress ? (
        <Text style={s.cargoStopAddress} numberOfLines={2}>{dropoffAddress}</Text>
      ) : null}
      <Text style={s.cargoHeading}>
        CARGO {index + 1}
        {dropoffLabel ? <Text style={{ color: D.faint }}> ({dropoffLabel})</Text> : null}
      </Text>

      <View style={s.innerBox}>
        <View style={s.cargoTop}>
          <View style={s.cargoTopLeft}>
            <Text style={s.cargoLabel}>Product</Text>
            <Text style={s.cargoProduct} numberOfLines={2}>{product ?? '—'}</Text>
          </View>
          {item.quantity != null && (
            <Text style={s.cargoQty}>
              <Text style={s.cargoQtyLabel}>Quantity: </Text>
              {item.quantity}
            </Text>
          )}
        </View>

        <SpecRow label="Commodity"            value={commodity} />
        <SpecRow label="Special Handling Code" value={shc} />
        <SpecRow label="Additional Special Handling Code" value={ashc} />
        <SpecRow label="Weight" value={item.weight_kg  != null ? `${item.weight_kg} kg`   : null} accent />
        <SpecRow label="Volume" value={item.volume_cbm != null ? `${item.volume_cbm} CBM` : null} accent />
        <SpecRow label="L × W × H" value={dims} accent />
      </View>
    </View>
  )
}

/** One label/value line in the cargo table. Skipped entirely when unset. */
function SpecRow({
  label, value, accent = false,
}: {
  label:   string
  value:   string | null
  accent?: boolean
}) {
  if (!value) return null
  return (
    <View style={s.specRow}>
      <Text style={s.specLabel} numberOfLines={2}>{label}</Text>
      <Text style={[s.specValue, accent && { color: D.cyan }]} numberOfLines={1}>{value}</Text>
    </View>
  )
}

const s = StyleSheet.create({
  shuttleNote: {
    color:        D.faint,
    fontSize:     12,
    lineHeight:   17,
    marginBottom: 10,
    fontFamily:   FONTS.spartan.medium,
  },
  tripGroup: {
    marginBottom: 12,
  },
  tripHead: {
    flexDirection: 'row',
    alignItems:    'center',
    gap:           8,
    marginBottom:  6,
  },
  tripTitle: {
    color:      D.white,
    fontSize:   12,
    letterSpacing: 0.6,
    fontFamily: FONTS.spartan.bold,
  },
  tripPill: {
    paddingHorizontal: 7,
    paddingVertical:   2,
    borderRadius:      16,
    borderWidth:       0.5,
    borderColor:       D.cardLine,
  },
  tripPillText: {
    color:      D.faint,
    fontSize:   9,
    letterSpacing: 0.5,
    fontFamily: FONTS.spartan.bold,
  },

  proofSection: {
    marginTop: 10,
    gap:       8,
  },
  proofHead: {
    flexDirection: 'row',
    alignItems:    'center',
    gap:           6,
  },
  proofTitle: {
    color:         D.faint,
    fontSize:      11,
    letterSpacing: 0.6,
    fontFamily:    FONTS.spartan.bold,
  },
  proofRow: {
    gap: 5,
  },
  proofTripTag: {
    color:         D.faint,
    fontSize:      10,
    letterSpacing: 0.5,
    fontFamily:    FONTS.spartan.bold,
  },
  proofBtn: {
    flexDirection:   'row',
    alignItems:      'center',
    justifyContent:  'center',
    gap:             9,
    height:          38,
    borderRadius:    10,
    borderWidth:     1,
    borderColor:     D.green,
    backgroundColor: D.greenDim,
  },
  proofBtnText: {
    color:      D.green,
    fontSize:   14,
    fontFamily: FONTS.spartan.bold,
  },
  proofDone: {
    flexDirection:   'row',
    alignItems:      'center',
    gap:             8,
    height:          38,
    paddingHorizontal: 12,
    borderRadius:    10,
    borderWidth:     1,
    borderColor:     D.cardLine,
    backgroundColor: D.inner,
  },
  proofDoneText: {
    color:      D.faint,
    fontSize:   13,
    flex:       1,
    fontFamily: FONTS.spartan.medium,
  },
  proofPending: {
    color:      D.amber,
    fontSize:   11,
    lineHeight: 16,
    fontFamily: FONTS.spartan.medium,
  },
  uploadError: {
    color:      D.red,
    fontSize:   12,
    lineHeight: 17,
    marginTop:  10,
    fontFamily: FONTS.spartan.medium,
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
    fontSize:  12,
    marginTop: 5,
  },
  tag: {
    height:            18,
    marginTop:         8,
    flexDirection:     'row',
    alignItems:        'center',
    gap:               4,
    paddingHorizontal: 8,
    borderRadius:      16,
    borderWidth:       0.4,
  },
  tagDot: {
    width:        6,
    height:       6,
    borderRadius: 3,
  },
  tagText: {
    fontSize:   12,
    fontWeight: '600',
  },

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
    color:    D.faint,
    fontSize: 14,
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
  stopNote: {
    fontFamily: FONTS.spartan.medium,
    fontSize:   11,
    color:      D.cyan,
    marginTop:  2,
  },
  cargoStopAddress: {
    fontFamily:   FONTS.spartan.medium,
    fontSize:     11,
    color:        D.faint,
    marginBottom: 4,
  },
  cargoHeading: {
    color:      D.cyan,
    fontSize:   14,
    marginTop:  12,
    fontFamily: FONTS.spartan.medium,
  },

  cargoTop: {
    flexDirection:  'row',
    alignItems:     'flex-end',
    justifyContent: 'space-between',
    gap:            12,
    paddingBottom:  10,
  },
  cargoTopLeft: {
    flex: 1,
  },
  cargoLabel: {
    color:    D.faint,
    fontSize: 12,
  },
  cargoProduct: {
    color:      D.cyan,
    fontSize:   14,
    fontWeight: '700',
    marginTop:  3,
  },
  cargoQty: {
    color:      D.cyan,
    fontSize:   14,
    fontWeight: '700',
    textAlign:  'right',
  },
  cargoQtyLabel: {
    color:      D.white,
    fontWeight: '400',
  },

  specRow: {
    flexDirection:  'row',
    alignItems:     'center',
    justifyContent: 'space-between',
    gap:            12,
    paddingVertical: 5,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: D.divider,
  },
  specLabel: {
    color:      D.faint,
    fontSize:   14,
    flexShrink: 1,
  },
  specValue: {
    color:     D.white,
    fontSize:  14,
    textAlign: 'right',
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
    paddingHorizontal: 24,
    paddingTop:        12,
    backgroundColor:   D.bg,
    borderTopWidth:    StyleSheet.hairlineWidth,
    borderTopColor:    D.divider,
  },
  offlineBanner: {
    flexDirection:     'row',
    alignItems:        'center',
    gap:               8,
    marginBottom:      10,
    paddingVertical:   9,
    paddingHorizontal: 12,
    borderRadius:      12,
    backgroundColor:   D.amberBg,
    borderWidth:       1,
    borderColor:       'rgba(245,158,11,0.35)',
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
    marginBottom:   10,
    justifyContent: 'center',
  },
  lockText: {
    color:    D.faint,
    fontSize: 12,
  },

  previewBtn: {
    height:         44,
    marginTop:      8,
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
})
