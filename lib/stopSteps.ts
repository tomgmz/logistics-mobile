import AsyncStorage from '@react-native-async-storage/async-storage'
import { useCallback, useEffect, useState } from 'react'

import api from './api/auth.api'
import { enqueue, flush } from './offlineQueue'
import { now as serverNow } from './serverTime'
import { readCurrentFix } from './stopGeofence'
import { parseLocalId } from './tripCargo'
import { cachedFetch } from './query/useApiQuery'
import { qk } from './query/keys'
import { useCatchUp, useLiveSignal } from '../hooks/useLiveSignal'

/**
 * The steps at each stop visit (user 2026-11-12), in this order, none skipped:
 *
 *   Arrived → Start loading/unloading → Loading/Unloading finished → proof
 *
 * The arrival is recorded by the app when navigation detects it, or by the
 * driver's "I've arrived" within 300 m of the stop (ARRIVAL_RADIUS_M). Start and
 * Finished are the driver's buttons; the proof popup opens only after Finished.
 * Each step needs the one before it (recordStep refuses otherwise), and the
 * server checks the same order and the 300 m. Parking, docking and departure
 * are no longer recorded.
 *
 * Each is recorded on this phone at once (so the button moves on even in a
 * dead zone) and sent through the offline queue with the phone's own time. Every
 * request also carries the phone's clock at the moment it is sent, so the
 * server corrects it by however far off this phone's clock is — a phone three
 * hours ahead still records the right time, offline or not.
 */

export type StepStage = 'arrived' | 'started' | 'finished'
/** `proof` = the proof confirmation (photo), recorded by the stop's own flow. */
export type StepTimes = Partial<Record<StepStage | 'proof', string>>

/** "I've arrived" (and a detected arrival) must be this close to the stop. */
export const ARRIVAL_RADIUS_M = 300

/** Where a step happened: the loading of a trip (no stop), or one drop-off visit. */
export interface StepTarget {
  tripId:      string
  tripStopId?: string | null
}

const key = (t: StepTarget) => `${t.tripId}:${t.tripStopId ?? 'load'}`
const storageKey = (bookingId: string) => `stop_steps_${bookingId}`

// Shared by every screen showing the booking (booking screen + map sheet).
const cache = new Map<string, Record<string, StepTimes>>()
/** Total goods loaded per trip, from the server's timeline (pieces, kg). */
export interface LoadedTotal { pieces: number; weight_kg: number | null }
const totals = new Map<string, Record<string, LoadedTotal | null>>()
const listeners = new Set<(bookingId: string) => void>()
const emit = (bookingId: string) => listeners.forEach((l) => l(bookingId))

async function readLocal(bookingId: string): Promise<Record<string, StepTimes>> {
  if (cache.has(bookingId)) return cache.get(bookingId)!
  try {
    const raw = await AsyncStorage.getItem(storageKey(bookingId))
    const parsed = raw ? JSON.parse(raw) : {}
    cache.set(bookingId, parsed)
    return parsed
  } catch {
    return {}
  }
}

async function writeLocal(bookingId: string, all: Record<string, StepTimes>): Promise<void> {
  cache.set(bookingId, all)
  emit(bookingId)
  try { await AsyncStorage.setItem(storageKey(bookingId), JSON.stringify(all)) } catch { /* next tap retries */ }
}

/** Server times win; a local tap not yet synced fills in what the server lacks. */
export async function refreshStopSteps(bookingId: string): Promise<void> {
  try {
    const data = await cachedFetch(qk.timeline(bookingId), async () => (await api.get(`/booking/${bookingId}/timeline`)).data)
    const local = await readLocal(bookingId)
    const merged: Record<string, StepTimes> = { ...local }
    const put = (t: StepTarget, times: Record<string, { at: string } | null>) => {
      const k = key(t)
      const server: StepTimes = {}
      // A server before 2026-11-12 sends no `proof`: its `finished` was the proof.
      const old = !('proof' in times)
      for (const [stage, v] of Object.entries(times)) {
        if (!v?.at) continue
        ;(server as any)[old && stage === 'finished' ? 'proof' : stage] = v.at
      }
      merged[k] = { ...(local[k] ?? {}), ...server }
    }
    const t: Record<string, LoadedTotal | null> = {}
    for (const trip of data?.data ?? []) {
      t[trip.trip_id] = trip.total_loaded ?? null
      put({ tripId: trip.trip_id }, trip.loading)
      for (const s of trip.stops ?? []) put({ tripId: trip.trip_id, tripStopId: s.trip_stop_id }, s)
    }
    totals.set(bookingId, t)
    await writeLocal(bookingId, merged)
  } catch {
    // Offline: the local taps stand.
  }
}

/** The proof was confirmed; mark it here too so the stop shows it at once. */
export async function markStepProof(bookingId: string, target: StepTarget): Promise<void> {
  const all = await readLocal(bookingId)
  const k = key(target)
  if (all[k]?.proof) return
  await writeLocal(bookingId, { ...all, [k]: { ...(all[k] ?? {}), proof: new Date(serverNow()).toISOString() } })
}

/** The steps recorded on this phone (or synced) for one visit. */
export async function stepTimes(bookingId: string, target: StepTarget): Promise<StepTimes> {
  return (await readLocal(bookingId))[key(target)] ?? {}
}

/**
 * The truck is at this stop. Silent and idempotent (the first one wins). The
 * caller has checked the 300 m (navigation's arrival or "I've arrived").
 */
export function markArrived(bookingId: string, target: StepTarget): Promise<void> {
  return recordStep(bookingId, target, 'arrived').then(() => {})
}

/**
 * One step. Recorded here at once; sent through the queue. Returns false when
 * it is out of order (the step before it isn't done yet) and nothing was
 * recorded; true when recorded or already there.
 */
export async function recordStep(bookingId: string, target: StepTarget, stage: StepStage): Promise<boolean> {
  const all = await readLocal(bookingId)
  const k = key(target)
  if (all[k]?.[stage]) return true
  // Already confirmed (proof): a step now would be late and out of order; the
  // office fills it in if it matters.
  if (all[k]?.proof) return true
  // No step skipped (user 2026-11-12).
  if (stage === 'started'  && !all[k]?.arrived) return false
  if (stage === 'finished' && !all[k]?.started) return false
  const fresh = all
  // Shown here at once on the server-corrected clock; SENT as the phone's own
  // time, which the server corrects by how far off this phone's clock is when
  // the tap finally goes out (X-Device-Time) — right even after a restart.
  const at = new Date().toISOString()
  const shownAt = new Date(serverNow()).toISOString()
  await writeLocal(bookingId, { ...fresh, [k]: { ...(fresh[k] ?? {}), [stage]: shownAt } })

  // A trip or stop the phone created offline has no server id yet: name it by
  // trip number + drop-off, as the confirmations do.
  const localTrip = parseLocalId(target.tripId)
  const localStop = target.tripStopId ? parseLocalId(target.tripStopId) : null
  const fix = await Promise.race([
    readCurrentFix().catch(() => null),
    new Promise<null>((r) => setTimeout(() => r(null), 3000)),
  ])

  await enqueue({
    id:     `step:${k}:${stage}`,
    kind:   'pickup',
    method: 'post',
    url:    `/driver/bookings/${bookingId}/milestones`,
    body: {
      stage,
      at,
      ...(localTrip ? { trip_number: localTrip.tripNumber } : { trip_id: target.tripId }),
      ...(target.tripStopId
        ? localStop?.destinationId
          ? { trip_number: localStop.tripNumber, destination_id: localStop.destinationId }
          : { trip_stop_id: target.tripStopId }
        : {}),
      ...(fix ? { latitude: fix.latitude, longitude: fix.longitude, ...(fix.accuracy_m != null ? { accuracy_m: fix.accuracy_m } : {}) } : {}),
    },
  })
  void flush()
  return true
}

/** The times on this booking's stops, kept current across screens. */
export function useStopSteps(bookingId: string) {
  const [all, setAll] = useState<Record<string, StepTimes>>(() => cache.get(bookingId) ?? {})

  useEffect(() => {
    let alive = true
    const onChange = (id: string) => { if (id === bookingId && alive) setAll({ ...(cache.get(bookingId) ?? {}) }) }
    listeners.add(onChange)
    void readLocal(bookingId).then(() => onChange(bookingId))
    void refreshStopSteps(bookingId)
    return () => { alive = false; listeners.delete(onChange) }
  }, [bookingId])

  // Live: a step the office filled in or corrected (stop_milestones signals
  // live:bookings with the booking id), the other driver's step, or a proof
  // confirmed for the driver shows without reopening; and once more on return
  // to the app or when the signal comes back.
  useLiveSignal('live:bookings', (ids) => { if (ids.has(bookingId)) void refreshStopSteps(bookingId) }, { enabled: !!bookingId })
  useCatchUp(() => { void refreshStopSteps(bookingId) }, { enabled: !!bookingId })

  const timesFor = useCallback((t: StepTarget): StepTimes => all[key(t)] ?? {}, [all])
  // `all` changes whenever a refresh lands, so this re-reads with it.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const totalFor = useCallback((tripId: string): LoadedTotal | null => totals.get(bookingId)?.[tripId] ?? null, [all, bookingId])
  const record = useCallback((t: StepTarget, stage: StepStage): Promise<boolean> => recordStep(bookingId, t, stage), [bookingId])
  return { timesFor, totalFor, record, refresh: () => refreshStopSteps(bookingId) }
}

/** The step this visit is waiting for; null once its proof is confirmed. */
export function nextStep(times: StepTimes): StepStage | 'proof' | null {
  if (times.proof)     return null
  if (!times.arrived)  return 'arrived'
  if (!times.started)  return 'started'
  if (!times.finished) return 'finished'
  return 'proof'
}

/** The button for a step. */
export function stepLabel(stage: StepStage | 'proof', kind: 'pickup' | 'dropoff'): string {
  switch (stage) {
    case 'arrived':  return 'I’ve arrived'
    case 'started':  return kind === 'pickup' ? 'Start loading' : 'Start unloading'
    case 'finished': return kind === 'pickup' ? 'Loading finished' : 'Unloading finished'
    case 'proof':    return kind === 'pickup' ? 'Proof of pickup' : 'Proof of delivery'
  }
}

/** The step as a done line in the list ("Arrived 09:42"). */
export function stepDoneLabel(stage: StepStage | 'proof', kind: 'pickup' | 'dropoff'): string {
  switch (stage) {
    case 'arrived':  return 'Arrived'
    case 'started':  return kind === 'pickup' ? 'Loading started' : 'Unloading started'
    case 'finished': return kind === 'pickup' ? 'Loading finished' : 'Unloading finished'
    case 'proof':    return 'Proof confirmed'
  }
}
