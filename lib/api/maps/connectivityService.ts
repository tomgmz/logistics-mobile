import NetInfo, { type NetInfoState } from '@react-native-community/netinfo'

export type ConnectionStatus = 'online' | 'offline' | 'unstable'

function classify(state: NetInfoState): ConnectionStatus {
  if (!state.isConnected) return 'offline'
  if (state.isInternetReachable == null) return 'unstable'
  if (state.isInternetReachable === false) return 'offline'
  return 'online'
}

export async function getConnectionStatus(timeoutMs = 3_000): Promise<ConnectionStatus> {
  const state = await NetInfo.fetch()

  if (state.isInternetReachable !== null) {
    return classify(state)
  }

  return new Promise<ConnectionStatus>((resolve) => {
    const timer = setTimeout(() => {
      unsubscribe()
      resolve('unstable')
    }, timeoutMs)

    const unsubscribe = NetInfo.addEventListener((s: NetInfoState) => {
      if (s.isInternetReachable === null) return
      clearTimeout(timer)
      unsubscribe()
      resolve(classify(s))
    })
  })
}

export function subscribeToConnectivity(
  onChange: (status: ConnectionStatus) => void,
): () => void {
  let last: ConnectionStatus | null = null

  return NetInfo.addEventListener((state: NetInfoState) => {
    if (state.isInternetReachable === null) return

    const next = classify(state)
    if (next !== last) {
      last = next
      onChange(next)
    }
  })
}
export async function withConnectivity<T>(
  fn: () => Promise<T>,
): Promise<T | null> {
  const status = await getConnectionStatus()
  if (status !== 'online') return null
  return fn()
}