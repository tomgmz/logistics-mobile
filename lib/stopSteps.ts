import AsyncStorage from '@react-native-async-storage/async-storage'
import { useCallback, useEffect, useState } from 'react'

import api from './api/auth.api'
import { enqueue, flush } from './offlineQueue'
import { now as serverNow } from './serverTime'
import { readCurrentFix } from './stopGeofence'
import { parseLocalId } from './tripCargo'

/**
 * The times at each stop:
 *
 *   Arrived → Start loading/unloading → [finish = the proof confirmation]
 *
 * The arrival is recorded by the app itself, never tapped: when navigation
 * detects the arrival, or when the driver opens the stop's proof popup or taps
 * Start, whichever comes first (markArrived). Start is the driver's one button.
 * Parking, docking and departure are no longer recorded.
 *
 * Each is recorded on this phone at once (so the button moves on even in a
 * dead zone) and sent through the offline queue with the phone's own time. Every
 * request also carries the phone's clock at the moment it is sent, so the
 * server corrects it by however far off this phone's clock is — a phone three
 * hours ahead still records the right time, offline or not.
 */

export type StepStage = 'arrived' | 'started'
export type StepTimes = Partial<Record<StepStage | 'finished', string>>

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
    const { data } = await api.get(`/booking/${bookingId}/timeline`)
    const local = await readLocal(bookingId)
    const merged: Record<string, StepTimes> = { ...local }
    const put = (t: StepTarget, times: Record<string, { at: string } | null>) => {
      const k = key(t)
      const server: StepTimes = {}
      for (const [stage, v] of Object.entries(times)) if (v?.at) (server as any)[stage] = v.at
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

/** The proof confirmation is the finish; mark it here too so the stop shows it at once. */
export async function markStepFinished(bookingId: string, target: StepTarget): Promise<void> {
  const all = await readLocal(bookingId)
  const k = key(target)
  if (all[k]?.finished) return
  await writeLocal(bookingId, { ...all, [k]: { ...(all[k] ?? {}), finished: new Date(serverNow()).toISOString() } })
}

/**
 * The truck is at this stop. Silent and idempotent: called on navigation's
 * arrival, on opening the proof popup and before Start, so the first one wins.
 */
export function markArrived(bookingId: string, target: StepTarget): Promise<void> {
  return recordStep(bookingId, target, 'arrived')
}

/** One step. Recorded here at once; sent through the queue. */
export async function recordStep(bookingId: string, target: StepTarget, stage: StepStage): Promise<void> {
  const all = await readLocal(bookingId)
  const k = key(target)
  if (all[k]?.[stage]) return
  // Already finished (proof confirmed): an arrival or start now would be late
  // and out of order — the office fills it in if it matters.
  if (all[k]?.finished) return
  // Start without an arrival (navigation missed it, or the driver was already
  // there): the arrival is now, just before the start.
  if (stage === 'started' && !all[k]?.arrived) await recordStep(bookingId, target, 'arrived')
  const fresh = stage === 'started' ? await readLocal(bookingId) : all
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

  const timesFor = useCallback((t: StepTarget): StepTimes => all[key(t)] ?? {}, [all])
  // `all` changes whenever a refresh lands, so this re-reads with it.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const totalFor = useCallback((tripId: string): LoadedTotal | null => totals.get(bookingId)?.[tripId] ?? null, [all, bookingId])
  const record = useCallback((t: StepTarget, stage: StepStage) => recordStep(bookingId, t, stage), [bookingId])
  return { timesFor, totalFor, record, refresh: () => refreshStopSteps(bookingId) }
}

/** The button to show: Start, until it is tapped or the stop is confirmed. */
export function nextStep(times: StepTimes): 'started' | null {
  return !times.started && !times.finished ? 'started' : null
}

export function stepLabel(stage: StepStage, kind: 'pickup' | 'dropoff'): string {
  switch (stage) {
    case 'arrived': return kind === 'pickup' ? 'Arrived at pickup' : 'Arrived at drop-off'
    case 'started': return kind === 'pickup' ? 'Start loading' : 'Start unloading'
  }
}
