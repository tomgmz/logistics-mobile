import axios, {
  AxiosInstance,
  AxiosError,
  InternalAxiosRequestConfig,
} from 'axios'
import * as SecureStore from 'expo-secure-store'
import { Platform } from 'react-native'
import { jwtDecode } from 'jwt-decode'

function getApiUrl(): string {
  const url = process.env.EXPO_PUBLIC_API_URL
  if (!url) throw new Error('EXPO_PUBLIC_API_URL is not set in your environment.')
  return url
}

const KEYS = {
  ACCESS_TOKEN:  'access_token',
  REFRESH_TOKEN: 'refresh_token',
} as const

const webStorage = {
  getItemAsync:    (key: string) => Promise.resolve(localStorage.getItem(key)),
  setItemAsync:    (key: string, value: string) => { localStorage.setItem(key, value); return Promise.resolve() },
  deleteItemAsync: (key: string) => { localStorage.removeItem(key); return Promise.resolve() },
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

const api: AxiosInstance = axios.create({
  baseURL: getApiUrl(),
  headers: { 'Content-Type': 'application/json' },
  timeout: 15_000,
})

interface JwtPayload { exp: number }

function isTokenExpiredOrExpiringSoon(token: string): boolean {
  try {
    const { exp } = jwtDecode<JwtPayload>(token)
    return exp * 1000 < Date.now() + 10_000
  } catch {
    return true
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

api.interceptors.request.use(async (config: InternalAxiosRequestConfig) => {
  const url = config.url ?? ''
  const isExcluded =
    url.includes('/auth/refresh')     ||
    url.includes('/auth/verify-otp')  ||
    url.includes('/auth/request-otp') ||
    url.includes('/auth/status')      ||
    url.includes('/auth/logout')

  if (isExcluded) return config

  let token = await TokenStore.getAccess()

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

  if (token) config.headers['Authorization'] = `Bearer ${token}`
  return config
})

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

function getDeviceInfo(): string {
  return `React Native — ${Platform.OS} ${Platform.Version}`
}

export interface AuthStatusResponse {
  locked:        boolean
  permanent?:    boolean
  locked_until?: string
  role:          string
}

export interface AuthUser {
  user_id:    string
  email:      string
  username:   string
  first_name: string | null
  last_name:  string | null
  role:       string
  status:     string

  drivers?: {
    driver_id:        string
    license_number:   string
    license_expiry:   string
    status:           string
    is_vendor_driver: boolean
  } | null

  clients?: {
    client_id:       string
    company_name:    string | null
    billing_address: string | null
    payment_terms:   number | null
  } | null
}

export interface AuthResponse {
  accessToken:      string
  refreshToken:     string
  accessExpiresAt:  string
  refreshExpiresAt: string
  user:             AuthUser
}

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

export async function verifyOtp(email: string, code: string): Promise<AuthResponse> {
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

export async function loginWithPassword(email: string, password: string): Promise<AuthResponse> {
  const { data } = await api.post<{ status: string; data: AuthResponse }>(
    '/auth/login',
    {
      email,
      password,
      device_info: getDeviceInfo(),
      platform:    'mobile',
    }
  )

  const auth = data.data
  if (!auth?.accessToken || !auth?.refreshToken) {
    throw new Error('login response is missing token fields.')
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