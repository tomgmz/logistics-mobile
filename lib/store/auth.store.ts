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
  hasHydrated:    boolean
  setUser:        (user: AuthUser) => void
  clearUser:      () => void
  setHasHydrated: (val: boolean) => void
}

export const useAuthStore = create<AuthStore>()(
  persist(
    (set) => ({
      user:           null,
      hasHydrated:    false,
      setUser:        (user) => set({ user }),
      clearUser:      () => set({ user: null }),
      setHasHydrated: (val) => set({ hasHydrated: val }),
    }),
    {
      name: 'auth-user',

      // Plug in the SecureStore adapter
      storage: createJSONStorage(() => secureStorage),

      // Only persist the fields we actually need — strips runtime-only state
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
              },
            }
          : { user: null },

      // Mark hydration complete so screens can gate on it
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true)
      },
    }
  )
)

export function useAuthHydrated(): boolean {
  return useAuthStore((s) => s.hasHydrated)
}