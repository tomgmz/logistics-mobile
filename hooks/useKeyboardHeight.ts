import { useEffect, useState } from 'react'
import { Keyboard, Platform } from 'react-native'

/**
 * How many pixels the on-screen keyboard covers, 0 while it is closed.
 *
 * For anything inside a React Native `Modal`. A Modal is its own window, so on
 * Android the screen's resize-for-keyboard never reaches it, and since Expo 54
 * (edge-to-edge) `KeyboardAvoidingView` with no `behavior` does nothing there
 * either: the field being typed into sat under the keyboard. Pad the modal's
 * container by this height and its content stays above the keys.
 *
 * `androidOnly` for a modal that already uses KeyboardAvoidingView
 * behavior="padding" on iOS, which handles iOS correctly on its own — padding
 * twice would leave a gap the size of the keyboard.
 *
 * Same approach as the chat photo sheet (components/messaging/ChatPhotoSheet),
 * which has worked on both platforms.
 */
export function useKeyboardHeight({ androidOnly = false }: { androidOnly?: boolean } = {}): number {
  const [height, setHeight] = useState(0)

  useEffect(() => {
    if (androidOnly && Platform.OS !== 'android') return
    const showEvt = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow'
    const hideEvt = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide'
    const show = Keyboard.addListener(showEvt, (e) => setHeight(e.endCoordinates.height))
    const hide = Keyboard.addListener(hideEvt, () => setHeight(0))
    return () => { show.remove(); hide.remove() }
  }, [androidOnly])

  return height
}
