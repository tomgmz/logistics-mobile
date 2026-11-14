import { useCallback, useEffect, useRef, useState } from 'react'
import AsyncStorage from '@react-native-async-storage/async-storage'

/**
 * Unsent text per chat, like WhatsApp / Telegram / Slack: leave a chat with
 * something typed and it is still in the box when you come back.
 *
 * Kept in memory (instant on reopen) and in AsyncStorage (survives the app
 * being closed). Keys carry the signed-in user, and signOutDriver clears them
 * all, so the next driver on a shared phone never sees someone else's draft.
 */

const PREFIX = 'msgDraft:'
const SAVE_DELAY_MS = 400

const memory = new Map<string, string>()

function storageKey(userId: string, chatKey: string) {
  return `${PREFIX}${userId}:${chatKey}`
}

async function persist(key: string, value: string) {
  try {
    if (value.trim()) await AsyncStorage.setItem(key, value)
    else await AsyncStorage.removeItem(key)
  } catch { /* storage full or unavailable: the in-memory copy still works */ }
}

/** Every saved draft on this phone (sign-out). */
export async function clearAllMessageDrafts(): Promise<void> {
  memory.clear()
  try {
    const keys = (await AsyncStorage.getAllKeys()).filter(k => k.startsWith(PREFIX))
    if (keys.length) await AsyncStorage.multiRemove(keys)
  } catch { /* non-fatal */ }
}

/**
 * The chat box's text, with its draft restored and saved.
 * `chatKey` names the chat ('dm:<user id>', 'group:<id>'); empty = no draft.
 */
export function useMessageDraft(userId: string, chatKey: string) {
  const key = userId && chatKey ? storageKey(userId, chatKey) : ''
  const [text, setTextState] = useState(() => (key ? memory.get(key) ?? '' : ''))
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const latest = useRef(text)
  const touched = useRef(false)

  // Not in memory (the app was closed since): read the saved copy, unless the
  // driver has already started typing.
  useEffect(() => {
    if (!key || memory.has(key)) return
    let cancelled = false
    AsyncStorage.getItem(key).then((saved) => {
      if (cancelled || !saved || touched.current) return
      memory.set(key, saved)
      latest.current = saved
      setTextState(saved)
    }).catch(() => {})
    return () => { cancelled = true }
  }, [key])

  // Leaving the chat: write what is in the box now.
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current)
    if (key) void persist(key, latest.current)
  }, [key])

  const setText = useCallback((next: string | ((prev: string) => string)) => {
    setTextState((prev) => {
      const value = typeof next === 'function' ? next(prev) : next
      touched.current = true
      latest.current = value
      if (key) {
        if (value.trim()) memory.set(key, value)
        else memory.delete(key)
        if (timer.current) clearTimeout(timer.current)
        timer.current = setTimeout(() => { void persist(key, value) }, SAVE_DELAY_MS)
      }
      return value
    })
  }, [key])

  return [text, setText] as const
}
