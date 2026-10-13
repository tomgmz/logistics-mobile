import { Alert } from 'react-native'
import { Check, CheckCheck } from 'lucide-react-native'

/**
 * Read status on your own messages: a double check once it has been seen, a
 * single check while it has not. Same meaning as on the web.
 */
export default function ReadTicks({ seen, size = 12 }: { seen: boolean; size?: number }) {
  return seen
    ? <CheckCheck size={size} color="#4df9ed" accessibilityLabel="Seen" />
    : <Check size={size} color="rgba(255,255,255,0.35)" accessibilityLabel="Sent" />
}

export type DeleteScope = 'me' | 'everyone'

function confirmScope(scope: DeleteScope, onConfirm: (scope: DeleteScope) => void): void {
  if (scope === 'everyone') {
    Alert.alert('Unsend this message?', 'It will be removed for everyone in this conversation.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Unsend', style: 'destructive', onPress: () => onConfirm('everyone') },
    ])
  } else {
    Alert.alert('Delete this message?', 'It will be deleted for you only. Everyone else in this conversation will still see it.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete for me', style: 'destructive', onPress: () => onConfirm('me') },
    ])
  }
}

/**
 * Removing a message, in two steps (same as the web): choose "Unsend for
 * everyone" (your own messages only) or "Delete for me", then confirm. With
 * only one option — someone else's message — it goes straight to confirming.
 */
export function chooseMessageRemoval(canUnsend: boolean, onConfirm: (scope: DeleteScope) => void): void {
  if (!canUnsend) { confirmScope('me', onConfirm); return }
  Alert.alert('Remove this message', undefined, [
    { text: 'Unsend for everyone', style: 'destructive', onPress: () => confirmScope('everyone', onConfirm) },
    { text: 'Delete for me', onPress: () => confirmScope('me', onConfirm) },
    { text: 'Cancel', style: 'cancel' },
  ])
}
