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

/**
 * "Delete this message?" before any message is removed. Deleting is only ever
 * for the person doing it; everyone else in the conversation keeps it.
 */
export function confirmDeleteMessage(onConfirm: () => void): void {
  Alert.alert(
    'Delete this message?',
    'It will be deleted for you only. Everyone else in this conversation will still see it.',
    [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete for me', style: 'destructive', onPress: onConfirm },
    ],
  )
}
