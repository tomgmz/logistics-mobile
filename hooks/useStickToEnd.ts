import { useCallback, useRef, useState } from 'react'
import type { FlatList, NativeScrollEvent, NativeSyntheticEvent } from 'react-native'

// Within this many points of the bottom still counts as "at the latest message".
const NEAR_END = 80

/**
 * Where a chat FlatList's scroll sits (same rules as the web):
 *
 *   - Opening a chat: `place(index)` once the messages and your last read are
 *     known lands on your first unread message, or `place(null)` on the
 *     newest one. Until then it stays on the end while the list fills in
 *     (FlatList renders long histories in batches).
 *   - After that it follows new content only while you are at the bottom; a
 *     reaction or a message arriving while you read further up leaves it be.
 *   - `jumpToEnd()` (you send, or tap the arrow-down) goes to the newest
 *     message and keeps following it. `atEnd` drives the arrow-down button.
 */
export function useStickToEnd(listRef: React.RefObject<FlatList | null>) {
  const pinned = useRef(true)
  const placed = useRef(false)
  const [atEnd, setAtEnd] = useState(true)

  const onContentSizeChange = useCallback(() => {
    if (pinned.current) listRef.current?.scrollToEnd({ animated: false })
  }, [listRef])

  const onScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent
    pinned.current = contentSize.height - contentOffset.y - layoutMeasurement.height < NEAR_END
    setAtEnd(pinned.current)
  }, [])

  /** Once per chat: the first unread entry's index, or null for the end. */
  const place = useCallback((index: number | null) => {
    if (placed.current) return
    placed.current = true
    if (index === null) {
      pinned.current = true
      listRef.current?.scrollToEnd({ animated: false })
      return
    }
    pinned.current = false
    setAtEnd(false)
    // Let the list lay out up to there first.
    setTimeout(() => listRef.current?.scrollToIndex({ index, viewPosition: 0, animated: false }), 60)
  }, [listRef])

  /** FlatList can't jump to a row it hasn't measured: get close, then retry. */
  const onScrollToIndexFailed = useCallback((info: { index: number; averageItemLength: number }) => {
    listRef.current?.scrollToOffset({ offset: info.averageItemLength * info.index, animated: false })
    setTimeout(() => listRef.current?.scrollToIndex({ index: info.index, viewPosition: 0, animated: false }), 80)
  }, [listRef])

  const jumpToEnd = useCallback((animated = true) => {
    pinned.current = true
    setAtEnd(true)
    listRef.current?.scrollToEnd({ animated })
  }, [listRef])

  /** True while the reader is at the newest message. */
  const isPinned = useCallback(() => pinned.current, [])

  return { onContentSizeChange, onScroll, onLayout: onContentSizeChange, onScrollToIndexFailed, place, jumpToEnd, isPinned, atEnd }
}
