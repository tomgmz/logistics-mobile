import { create } from 'zustand'
import { persist, createJSONStorage, StateStorage } from 'zustand/middleware'
import * as SecureStore from 'expo-secure-store'
import { Platform } from 'react-native'
import { AuthUser } from '../api/auth.api'

const secureStorage: StateStorage = Platform.OS === 'web'
  ? {
      getItem:    (key)        => Promise.resolve(localStorage.getItem(key)),
      setItem:    (key, value) => Promise.resolve(localStorage.setItem(key, value)),
      removeItem: (key)        => Promise.resolve(localStorage.removeItem(key)),
    }
  : {
      getItem:    (key)        => SecureStore.getItemAsync(key),
      setItem:    (key, value) => SecureStore.setItemAsync(key, value),
      removeItem: (key)        => SecureStore.deleteItemAsync(key),
    }

interface AuthStore {
  user:           AuthUser | null
  accessToken:    string | null
  refreshToken:   string | null
  hasHydrated:    boolean

  setUser:        (user: AuthUser) => void
  setTokens:      (access: string, refresh: string) => void
  clearUser:      () => void
  setHasHydrated: (val: boolean) => void
}

export const useAuthStore = create<AuthStore>()(
  persist(
    (set) => ({
      user:           null,
      accessToken:    null,
      refreshToken:   null,
      hasHydrated:    false,

      setUser: (user) => set({ user }),

      setTokens: (accessToken, refreshToken) =>
        set({ accessToken, refreshToken }),

      clearUser: () =>
        set({
          user: null,
          accessToken: null,
          refreshToken: null,
        }),

      setHasHydrated: (val) => set({ hasHydrated: val }),
    }),
    {
      name: 'auth-user',
      storage: createJSONStorage(() => secureStorage),

      partialize: (state) =>
        state.user
          ? {
              user: {
                user_id:    state.user.user_id,
                email:      state.user.email,
                username:   state.user.username,
                first_name: state.user.first_name,
                last_name:  state.user.last_name,
                role:       state.user.role,
                status:     state.user.status,
                drivers:           state.user.drivers           ?? null,
                assistant_drivers: state.user.assistant_drivers ?? null,
                clients:           state.user.clients           ?? null,
              },
              accessToken:  state.accessToken,
              refreshToken: state.refreshToken,
            }
          : {
              user: null,
              accessToken: null,
              refreshToken: null,
            },

      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true)
      },
    }
  )
)

export function useUserId(): string | null {
  return useAuthStore((s) => s.user?.user_id ?? null)
}

export function useDriverId(){
  return useAuthStore((s) => s.user?.drivers?.driver_id ?? null)
}

export function useUserRole(): string | null {
  return useAuthStore((s) => s.user?.role ?? null)
}

export function useAuthHydrated(): boolean {
  return useAuthStore((s) => s.hasHydrated)
}