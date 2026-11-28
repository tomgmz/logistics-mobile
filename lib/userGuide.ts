import { Directory, File, Paths } from 'expo-file-system'
import api from './api/auth.api'

/**
 * The user guide PDF for the in-app User Guide screen (2026-11-28).
 *
 * GET /api/user-guide sends the guide for the signed-in role. A copy is kept in
 * the app's document folder (not the cache, which Android may clear), so the
 * guide still opens at a warehouse or on the road with no signal. Each open
 * asks the server with If-None-Match: an unchanged guide is a 304 and the
 * saved copy is used; a new edition replaces it.
 */

const DIR = new Directory(Paths.document, 'user-guide')

function fileFor(role: string)  { return new File(DIR, `${role}.pdf`) }
function etagFor(role: string)  { return new File(DIR, `${role}.etag`) }

export interface GuideResult {
  /** file:// path for the viewer. */
  uri: string
  /** True when the server could not be reached and the saved copy is shown. */
  offline: boolean
}

export class GuideUnavailable extends Error {}

export async function loadUserGuide(role: string): Promise<GuideResult> {
  // A role id only ever comes from the signed-in user; keep it to plain names
  // so it can never become a path.
  if (!/^[a-z_]+$/.test(role)) throw new GuideUnavailable('There is no user guide for your role yet.')

  const pdf  = fileFor(role)
  const tag  = etagFor(role)
  const have = pdf.exists && pdf.size > 0
  let etag: string | null = null
  if (have && tag.exists) {
    try { etag = (await tag.text()).trim() || null } catch { etag = null }
  }

  try {
    const res = await api.get<ArrayBuffer>('/user-guide', {
      responseType:   'arraybuffer',
      headers:        etag ? { 'If-None-Match': etag } : {},
      validateStatus: (s) => s === 200 || s === 304,
      timeout:        30_000,
    })

    if (res.status === 304 && have) return { uri: pdf.uri, offline: false }

    const bytes = new Uint8Array(res.data)
    // A real PDF starts with "%PDF"; anything else (a proxy's error page) is
    // never saved over a good copy.
    if (bytes.length < 5 || bytes[0] !== 0x25 || bytes[1] !== 0x50 || bytes[2] !== 0x44 || bytes[3] !== 0x46) {
      throw new Error('not a pdf')
    }

    DIR.create({ idempotent: true, intermediates: true })
    // Write to a side file first, then swap it in, so a write cut short (app
    // killed, phone full) never leaves a broken guide behind.
    const tmp = new File(DIR, `${role}.pdf.tmp`)
    if (tmp.exists) tmp.delete()
    tmp.create()
    tmp.write(bytes)
    if (pdf.exists) pdf.delete()
    tmp.move(pdf)

    const newTag = res.headers?.etag as string | undefined
    if (tag.exists) tag.delete()
    if (newTag) { tag.create(); tag.write(newTag) }

    return { uri: pdf.uri, offline: false }
  } catch (err: any) {
    const status = err?.response?.status as number | undefined
    if (status === 404) throw new GuideUnavailable('There is no user guide for your role yet.')
    // No signal, a timeout or a server hiccup: the saved copy is still good.
    if (have) return { uri: pdf.uri, offline: true }
    if (!err?.response) {
      throw new GuideUnavailable('The guide could not be downloaded. Check your signal and try again. Once it has opened once, it also opens without signal.')
    }
    throw new GuideUnavailable(err?.response?.data?.message ?? 'The user guide is not available right now. Please try again later.')
  }
}
