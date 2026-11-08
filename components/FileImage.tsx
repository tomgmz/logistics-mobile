import React, { useEffect, useState } from 'react'
import { Image, View, type ImageProps, type ImageSourcePropType } from 'react-native'
import { getFreshAccessToken } from '../lib/api/auth.api'

/*
 * Stored-file pictures (2026-11-08). The API's file links are sealed links to
 * GET /api/files that only open for the account they were issued to, so the
 * picture is requested with this driver's Bearer token. A link copied out of
 * the app opens nothing. Local pictures (file://, content://, data:) and any
 * other link are shown as they are.
 *
 * Older app versions send no token, so they show no stored pictures until
 * updated (accepted, 2026-11-08).
 */

export function isSealedFileLink(uri: string | null | undefined): uri is string {
  return !!uri && uri.includes('/api/files/') && uri.includes('t=')
}

/** The Image source for `uri`, with the sign-in header when it is a stored file. Undefined while the token is read. */
export function useFileSource(uri: string | null | undefined): ImageSourcePropType | undefined {
  const sealed = isSealedFileLink(uri)
  const [auth, setAuth] = useState<{ for: string; token: string | null } | null>(null)

  useEffect(() => {
    if (!sealed || !uri) return
    let alive = true
    getFreshAccessToken().then(
      (token) => { if (alive) setAuth({ for: uri, token }) },
      () => { if (alive) setAuth({ for: uri, token: null }) },
    )
    return () => { alive = false }
  }, [uri, sealed])

  if (!uri) return undefined
  if (!sealed) return { uri }
  if (!auth || auth.for !== uri || !auth.token) return undefined
  return { uri, headers: { Authorization: `Bearer ${auth.token}` } }
}

/** <Image> for a stored file: same props, `uri` instead of `source`. */
export default function FileImage({ uri, style, ...rest }: Omit<ImageProps, 'source'> & { uri: string }) {
  const source = useFileSource(uri)
  if (!source) return <View style={style} />
  return <Image {...rest} style={style} source={source} />
}
