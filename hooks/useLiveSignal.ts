import { useEffect, useRef } from 'react'
import { AppState } from 'react-native'
import { supabase } from '../lib/supabase'

/**
 * Re-read a screen when the rows behind it change — the mobile side of the web's
 * useLiveTable.
 *
 * Database triggers broadcast `changed` on public topics (backend migration
 * 20260928050000_live_table_signals), e.g. `live:driver_reports`. The payload is
 * only { table, id }: anon-key channels are public, so the signal never carries
 * data and the screen re-reads from the API, which applies the driver's scoping.
 */
export type LiveTopic = 'live:driver_reports' | 'live:bookings' | 'live:trucks'

type Listener = (id: string | null) => void

// supabase.channel() hands back the same channel for the same name, so every
// screen on a topic shares one subscription — removed only when the last one
// leaves. Without this, the report detail pushed over the list would tear down
// the list's channel when it unmounts.
const channels = new Map<string, { ch: ReturnType<typeof supabase.channel>; listeners: Set<Listener> }>()

function subscribe(topic: LiveTopic, listener: Listener): () => void {
  let entry = channels.get(topic)
  if (!entry) {
    const listeners = new Set<Listener>()
    const ch = supabase
      .channel(topic)
      .on('broadcast', { event: 'changed' }, ({ payload }) => {
        const id = (payload as { id?: unknown } | undefined)?.id
        listeners.forEach((l) => l(typeof id === 'string' ? id : null))
      })
      .subscribe()
    entry = { ch, listeners }
    channels.set(topic, entry)
  }
  entry.listeners.add(listener)

  return () => {
    const e = channels.get(topic)
    if (!e) return
    e.listeners.delete(listener)
    if (e.listeners.size === 0) {
      channels.delete(topic)
      void supabase.removeChannel(e.ch)
    }
  }
}

/**
 * Calls `onChange` after rows on `topic` change. A burst (one save can touch
 * several rows) is coalesced into one call, with the ids it covered. The screen
 * is also re-read when the app returns to the foreground, since signals sent
 * while it was in the background never arrived (called with an empty set).
 */
export function useLiveSignal(
  topic: LiveTopic,
  onChange: (ids: Set<string>) => void,
  { enabled = true, debounceMs = 600 }: { enabled?: boolean; debounceMs?: number } = {},
): void {
  // Latest callback without re-subscribing on every render.
  const onChangeRef = useRef(onChange)
  useEffect(() => { onChangeRef.current = onChange })

  useEffect(() => {
    if (!enabled) return
    let timer: ReturnType<typeof setTimeout> | undefined
    let ids = new Set<string>()

    const unsubscribe = subscribe(topic, (id) => {
      if (id) ids.add(id)
      clearTimeout(timer)
      timer = setTimeout(() => {
        const batch = ids
        ids = new Set()
        onChangeRef.current(batch)
      }, debounceMs)
    })

    let appState = AppState.currentState
    const sub = AppState.addEventListener('change', (next) => {
      if (/inactive|background/.test(appState) && next === 'active') onChangeRef.current(new Set())
      appState = next
    })

    return () => {
      clearTimeout(timer)
      sub.remove()
      unsubscribe()
    }
  }, [topic, enabled, debounceMs])
}
