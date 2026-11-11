import { useState } from 'react'
import { useQuery, type QueryKey, type UseQueryOptions } from '@tanstack/react-query'
import { useAuthStore } from '../store/auth.store'
import { queryClient } from './client'

/**
 * The driver app's helpers on the shared TanStack Query cache (client.ts),
 * the same names and rules as the web's lib/query/useApiQuery.
 */

const FILE_LINK_MARK   = '/api/files'
const FILE_DATA_MAX_MS = 5 * 60_000

function holdsFileLink(value: unknown): boolean {
  try { return JSON.stringify(value)?.includes(FILE_LINK_MARK) ?? false } catch { return true }
}

/** The account part of every key. */
export function useAccountScope(): string | null {
  return useAuthStore((s) => s.user?.user_id ?? null)
}

function currentScope(): string | null {
  return useAuthStore.getState().user?.user_id ?? null
}

/** Full key for `key` under the signed-in account. */
export function scopedKey(scope: string | null, key: QueryKey): QueryKey {
  return [scope ?? 'signed-out', ...key]
}

/**
 * useQuery under the account scope, with the file-link rule (cached data with
 * /api/files links older than 5 min is hidden until the fresh read lands).
 * Disabled while signed out.
 */
export function useApiQuery<T>(
  key: QueryKey,
  queryFn: () => Promise<T>,
  options: Omit<UseQueryOptions<T, Error, T, QueryKey>, 'queryKey' | 'queryFn'> = {},
) {
  const scope = useAccountScope()
  const [openedAt] = useState(() => Date.now())
  const query = useQuery<T, Error, T, QueryKey>({
    ...options,
    queryKey: scopedKey(scope, key),
    queryFn,
    enabled: !!scope && (options.enabled ?? true),
  })
  const tooOld = query.data !== undefined
    && query.dataUpdatedAt < openedAt
    && openedAt - query.dataUpdatedAt > FILE_DATA_MAX_MS
    && holdsFileLink(query.data)
  if (!tooOld) return query
  return { ...query, data: undefined, isPending: true, isSuccess: false, status: 'pending' } as unknown as typeof query
}

/** Invalidate every query under the signed-in account whose key starts with `prefix`. */
export function invalidateScoped(prefix: QueryKey) {
  return queryClient.invalidateQueries({ queryKey: scopedKey(currentScope(), prefix) })
}

/**
 * For screens that load in their own code (offline fallbacks, live re-reads,
 * pending-confirmation overlays): the last answer kept for `key` under the
 * signed-in account. File-link data older than 5 min is not returned.
 */
export function cachedData<T>(key: QueryKey): T | undefined {
  const scope = currentScope()
  if (!scope) return undefined
  const state = queryClient.getQueryState<T>(scopedKey(scope, key))
  if (state?.data === undefined) return undefined
  if (Date.now() - state.dataUpdatedAt > FILE_DATA_MAX_MS && holdsFileLink(state.data)) return undefined
  return state.data
}

/** Keep a fresh answer for `key` under the signed-in account. */
export function storeData<T>(key: QueryKey, data: T): void {
  const scope = currentScope()
  if (!scope) return
  queryClient.setQueryData<T>(scopedKey(scope, key), data)
}

/**
 * For a load written as `fetch().then(apply)`: applies the answer kept for
 * `key` at once (if any), then fetches, keeps and returns the fresh one.
 * Two screens asking for the same key at the same moment share ONE request
 * (TanStack's de-duplication), e.g. home and the assignments list.
 */
export function cachedFetch<T>(key: QueryKey, fetcher: () => Promise<T>, applyCached?: (data: T) => void): Promise<T> {
  const cached = cachedData<T>(key)
  if (cached !== undefined && applyCached) applyCached(cached)
  const scope = currentScope()
  if (!scope) return fetcher()
  // No retry here: the caller's own error path (an offline fallback) must run
  // exactly when the request fails, as before.
  return queryClient.fetchQuery<T>({ queryKey: scopedKey(scope, key), queryFn: fetcher, staleTime: 0, retry: false })
}
