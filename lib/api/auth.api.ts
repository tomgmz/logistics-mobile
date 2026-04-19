/**
 * auth.api.ts
 * React Native auth client for the Express/TypeScript backend.
 *
 * Install:
 *   npx expo install expo-secure-store
 *   npm install axios jwt-decode
 *
 * .env:
 *   EXPO_PUBLIC_API_URL=http://192.168.x.x:4000/api
 */

import axios, {
  AxiosInstance,
  AxiosError,
  InternalAxiosRequestConfig,
} from 'axios'
import * as SecureStore from 'expo-secure-store'
import { Platform } from 'react-native'
import { jwtDecode } from 'jwt-decode'

// ─── Environment guard (lazy — does NOT throw at module load time) ────────────
//
// Previously this was a top-level throw which crashed the entire app before
// anything could render, causing a white screen.
// Now it only throws when an actual API call is made.

function getApiUrl(): string {
  const url = process.env.EXPO_PUBLIC_API_URL
  if (!url) throw new Error('EXPO_PUBLIC_API_URL is not set in your environment.')
  return url
}

// ─── Storage keys ─────────────────────────────────────────────────────────────

const KEYS = {
  ACCESS_TOKEN:  'access_token',
  REFRESH_TOKEN: 'refresh_token',
} as const

// ─── Web fallback for SecureStore (expo web compatibility) ────────────────────

const webStorage = {
  getItemAsync: (key: string) => Promise.resolve(localStorage.getItem(key)),
  setItemAsync: (key: string, value: string) => {
    localStorage.setItem(key, value)
    return Promise.resolve()
  },
  deleteItemAsync: (key: string) => {
    localStorage.removeItem(key)
    return Promise.resolve()
  },
}

const storage = Platform.OS === 'web'
  ? webStorage
  : {
      getItemAsync:    SecureStore.getItemAsync.bind(SecureStore),
      setItemAsync:    SecureStore.setItemAsync.bind(SecureStore),
      deleteItemAsync: SecureStore.deleteItemAsync.bind(SecureStore),
    }

export const TokenStore = {
  getAccess:    () => storage.getItemAsync(KEYS.ACCESS_TOKEN),
  getRefresh:   () => storage.getItemAsync(KEYS.REFRESH_TOKEN),
  setAccess:    (t: string) => storage.setItemAsync(KEYS.ACCESS_TOKEN, t),
  setRefresh:   (t: string) => storage.setItemAsync(KEYS.REFRESH_TOKEN, t),
  clearAccess:  () => storage.deleteItemAsync(KEYS.ACCESS_TOKEN),
  clearRefresh: () => storage.deleteItemAsync(KEYS.REFRESH_TOKEN),
  clearAll:     async () => {
    await storage.deleteItemAsync(KEYS.ACCESS_TOKEN)
    await storage.deleteItemAsync(KEYS.REFRESH_TOKEN)
  },
}

// ─── Axios instance ───────────────────────────────────────────────────────────

const api: AxiosInstance = axios.create({
  baseURL: '',
  headers: { 'Content-Type': 'application/json' },
  timeout: 15_000,
  // no withCredentials — mobile uses Bearer tokens, not cookies
})

// ─── Token refresh helpers ────────────────────────────────────────────────────

interface JwtPayload {
  exp: number
}

/** Returns true if the token expires within the next 10 seconds. */
function isTokenExpiredOrExpiringSoon(token: string): boolean {
  try {
    const { exp } = jwtDecode<JwtPayload>(token)
    return exp * 1000 < Date.now() + 10_000
  } catch {
    return true // treat undecodable tokens as expired
  }
}

let isRefreshing = false

type QueueEntry = {
  resolve: (token: string) => void
  reject:  (e: unknown) => void
}
let failedQueue: QueueEntry[] = []

function processQueue(error: unknown, token: string | null = null) {
  failedQueue.forEach(e => (error ? e.reject(error) : e.resolve(token!)))
  failedQueue = []
}

let _onSessionExpired: (() => void) | null = null
export function setSessionExpiredHandler(fn: () => void) {
  _onSessionExpired = fn
}

// ─── Internal refresh call (bypasses interceptors) ───────────────────────────

async function doRefresh(): Promise<string> {
  const refreshToken = await TokenStore.getRefresh()
  if (!refreshToken) throw new Error('No refresh token stored.')

  const { data } = await axios.post<{ status: string; data: { accessToken: string } }>(
    `${getApiUrl()}/auth/refresh`,
    { refreshToken },
    { headers: { 'Content-Type': 'application/json' } }
  )

  const newToken = data?.data?.accessToken
  if (!newToken) throw new Error('Refresh response missing accessToken.')

  await TokenStore.setAccess(newToken)
  return newToken
}

// ─── Request interceptor — attach token, proactive refresh ───────────────────

api.interceptors.request.use(async (config: InternalAxiosRequestConfig) => {
  config.baseURL = getApiUrl()
  const url = config.url ?? ''
  const isExcluded =
    url.includes('/auth/refresh')     ||
    url.includes('/auth/verify-otp')  ||
    url.includes('/auth/request-otp') ||
    url.includes('/auth/status')      ||
    url.includes('/auth/logout')

  if (isExcluded) return config

  let token = await TokenStore.getAccess()

  // Proactively refresh if token is expired or about to expire
  if (token && isTokenExpiredOrExpiringSoon(token)) {
    if (!isRefreshing) {
      isRefreshing = true
      try {
        token = await doRefresh()
        processQueue(null, token)
      } catch (e) {
        processQueue(e)
        await TokenStore.clearAll()
        _onSessionExpired?.()
        throw e
      } finally {
        isRefreshing = false
      }
    } else {
      token = await new Promise<string>((resolve, reject) => {
        failedQueue.push({ resolve, reject })
      })
    }
  }

  if (token) {
    config.headers['Authorization'] = `Bearer ${token}`
  }

  return config
})

// ─── Response interceptor — reactive 401 handling ────────────────────────────

api.interceptors.response.use(
  res => res,
  async (error: AxiosError) => {
    const original = error.config as InternalAxiosRequestConfig & { _retry?: boolean }

    const url = original?.url ?? ''
    const isExcluded =
      url.includes('/auth/refresh')     ||
      url.includes('/auth/verify-otp')  ||
      url.includes('/auth/request-otp') ||
      url.includes('/auth/status')      ||
      url.includes('/auth/logout')

    if (error.response?.status === 401 && !original?._retry && !isExcluded) {
      if (isRefreshing) {
        return new Promise<string>((resolve, reject) => {
          failedQueue.push({ resolve, reject })
        })
          .then(token => {
            original.headers['Authorization'] = `Bearer ${token}`
            return api(original)
          })
          .catch(e => Promise.reject(e))
      }

      original._retry = true
      isRefreshing    = true

      try {
        const newToken = await doRefresh()
        original.headers['Authorization'] = `Bearer ${newToken}`
        processQueue(null, newToken)
        return api(original)
      } catch (refreshError) {
        processQueue(refreshError)
        await TokenStore.clearAll()
        _onSessionExpired?.()
        return Promise.reject(refreshError)
      } finally {
        isRefreshing = false
        failedQueue  = []
      }
    }

    return Promise.reject(error)
  }
)

// ─── Device info ──────────────────────────────────────────────────────────────

function getDeviceInfo(): string {
  return `React Native — ${Platform.OS} ${Platform.Version}`
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AuthStatusResponse {
  locked:        boolean
  permanent?:    boolean
  locked_until?: string
}

export interface AuthUser {
  user_id:    string
  email:      string
  username:   string
  first_name: string | null
  last_name:  string | null
  role:       string
  status:     string
}

export interface AuthResponse {
  accessToken:      string
  refreshToken:     string
  accessExpiresAt:  string
  refreshExpiresAt: string
  user:             AuthUser
}

// ─── Auth API functions ───────────────────────────────────────────────────────

export async function getAuthStatus(email: string): Promise<AuthStatusResponse> {
  const { data } = await api.post<{ status: string; data: AuthStatusResponse }>(
    '/auth/status',
    { email }
  )
  return data.data
}

export async function requestOtp(email: string): Promise<void> {
  await api.post('/auth/request-otp', { email })
}

export async function verifyOtp(
  email: string,
  code:  string,
): Promise<AuthResponse> {
  const { data } = await api.post<{ status: string; data: AuthResponse }>(
    '/auth/verify-otp',
    {
      email,
      code,
      device_info: getDeviceInfo(),
      platform:    'mobile',
    }
  )

  const auth = data.data
  if (!auth?.accessToken || !auth?.refreshToken) {
    throw new Error('verify-otp response is missing token fields.')
  }

  await TokenStore.setAccess(auth.accessToken)
  await TokenStore.setRefresh(auth.refreshToken)
  return auth
}

export async function getMe(): Promise<AuthUser> {
  const { data } = await api.get<{ status: string; data: AuthUser }>('/auth/me')
  return data.data
}

export async function logout(): Promise<void> {
  try {
    await api.post('/auth/logout')
  } finally {
    // Always clear local tokens even if the server request fails
    await TokenStore.clearAll()
  }
}

export async function logoutAll(): Promise<void> {
  try {
    await api.post('/auth/logout-all')
  } finally {
    await TokenStore.clearAll()
  }
}

export default api