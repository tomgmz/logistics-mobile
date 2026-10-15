import { useCallback, useRef } from 'react'
import type { FlatList, NativeScrollEvent, NativeSyntheticEvent } from 'react-native'

// Within this many points of the bottom still counts as "at the latest message".
const NEAR_END = 80

/**
 * Keeps a chat FlatList on its latest message.
 *
 * Opening a chat lands on the newest message, and the list stays there while
 * it is still growing — FlatList renders long histories in batches, and each
 * batch made a one-off scrollToEnd land short of the bottom. Once the reader
 * scrolls up to read older messages the list is left alone, until `pin()`
 * (they send something) puts it back on the end.
 */
export function useStickToEnd(listRef: React.RefObject<FlatList | null>) {
  const pinned = useRef(true)

  const onContentSizeChange = useCallback(() => {
    if (pinned.current) listRef.current?.scrollToEnd({ animated: false })
  }, [listRef])

  const onScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent
    pinned.current = contentSize.height - contentOffset.y - layoutMeasurement.height < NEAR_END
  }, [])

  const pin = useCallback(() => { pinned.current = true }, [])

  return { onContentSizeChange, onScroll, onLayout: onContentSizeChange, pin }
}
