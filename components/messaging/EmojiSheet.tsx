import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  View, Text, TextInput, TouchableOpacity,
  FlatList, StyleSheet, Dimensions, ActivityIndicator, InteractionManager,
} from 'react-native'
import { Search } from 'lucide-react-native'
import { FONTS } from '../../lib/config/fonts'

interface EmojiSkin { unified: string; native: string }
interface EmojiEntry {
  id: string
  name: string
  keywords?: string[]
  emoticons?: string[]
  skins: EmojiSkin[]
}
interface EmojiDataShape {
  categories: { id: string; emojis: string[] }[]
  emojis: Record<string, EmojiEntry>
}

/** What the panel draws: per category, the emoji glyphs already cut into rows of COLS. */
interface Prepared {
  categories: { id: string; rows: string[][] }[]
}

const C = {
  bg:     '#181818',
  border: 'rgba(255,255,255,0.07)',
  field:  'rgba(255,255,255,0.05)',
  active: 'rgba(255,255,255,0.10)',
  white:  '#ffffff',
  muted:  '#818181',
  cyan:   '#4df9ed',
  overlay:'rgba(0,0,0,0.6)',
}

const CATEGORY_ICON: Record<string, string> = {
  people:   '😀',
  nature:   '🐵',
  foods:    '🍕',
  activity: '⚽',
  places:   '✈️',
  objects:  '💡',
  symbols:  '❤️',
  flags:    '🏁',
}

const COLS = 8
const SCREEN_W = Dimensions.get('window').width
const SCREEN_H = Dimensions.get('window').height
const PANEL_H = Math.round(SCREEN_H * 0.38)
const CELL = Math.floor((SCREEN_W - 24) / COLS)

// Module-level: read once per app session, shared by every chat screen.
let _data: EmojiDataShape | null = null
let _prepared: Prepared | null = null
let _searchIndex: { native: string; text: string }[] | null = null

function loadData(): EmojiDataShape {
  if (!_data) {
    _data = require('@emoji-mart/data') as unknown as EmojiDataShape
  }
  return _data
}

function toRows(glyphs: string[]): string[][] {
  const rows: string[][] = []
  for (let i = 0; i < glyphs.length; i += COLS) rows.push(glyphs.slice(i, i + COLS))
  return rows
}

function nativeOf(d: EmojiDataShape, id: string): string {
  return d.emojis[id]?.skins[0]?.native ?? ''
}

function prepare(): Prepared {
  if (!_prepared) {
    const d = loadData()
    _prepared = {
      categories: d.categories.map(cat => ({
        id: cat.id,
        rows: toRows(cat.emojis.map(id => nativeOf(d, id)).filter(Boolean)),
      })),
    }
  }
  return _prepared
}

/** Built only when the driver first types in the search box. */
function getSearchIndex(): { native: string; text: string }[] {
  if (!_searchIndex) {
    const d = loadData()
    const idx: { native: string; text: string }[] = []
    for (const id of Object.keys(d.emojis)) {
      const e = d.emojis[id]
      const native = nativeOf(d, id)
      if (!native) continue
      idx.push({ native, text: [e.name, ...(e.keywords ?? []), ...(e.emoticons ?? [])].join(' ').toLowerCase() })
    }
    _searchIndex = idx
  }
  return _searchIndex
}

/**
 * Reads and prepares the emoji list in the background, after the screen's
 * opening animation, so the first tap on the emoji button doesn't wait for it.
 */
function preloadEmojis() {
  if (_prepared) return
  InteractionManager.runAfterInteractions(() => {
    // One more frame so the chat's own first render isn't held up.
    setTimeout(() => { prepare() }, 300)
  })
}

interface RowProps { glyphs: string[]; onPress: (e: string) => void }

/**
 * One row of emojis: a row container with plain pressable Text cells (no
 * TouchableOpacity wrapper per emoji, which doubled the native views and added
 * an animation per cell).
 */
const EmojiRow = React.memo(function EmojiRow({ glyphs, onPress }: RowProps) {
  return (
    <View style={s.row}>
      {glyphs.map((g, i) => (
        <Text key={i} style={s.cell} onPress={() => onPress(g)} suppressHighlighting={false}>
          {g}
        </Text>
      ))}
    </View>
  )
})

interface EmojiSheetProps {
  visible:  boolean
  onClose:  () => void
  onSelect: (emoji: string) => void
}

export default function EmojiSheet({ visible, onSelect }: EmojiSheetProps) {
  const [prepared, setPrepared] = useState<Prepared | null>(_prepared)
  const [search, setSearch]     = useState('')
  const [catIndex, setCatIndex] = useState(0)
  // Once opened, the panel stays mounted (hidden) so reopening is instant.
  const [everOpened, setEverOpened] = useState(visible)

  // Prepare in the background as soon as a chat opens.
  useEffect(() => { preloadEmojis() }, [])

  useEffect(() => {
    if (!visible) return
    setEverOpened(true)
    if (!prepared) {
      // Opened before the background preload finished: show the spinner, then prepare.
      const t = setTimeout(() => setPrepared(prepare()), 0)
      return () => clearTimeout(t)
    }
  }, [visible, prepared])

  const q = search.trim().toLowerCase()

  const rows = useMemo(() => {
    if (!prepared) return []
    if (!q) return prepared.categories[catIndex]?.rows ?? []
    return toRows(getSearchIndex().filter(e => e.text.includes(q)).map(e => e.native))
  }, [prepared, q, catIndex])

  const onSelectRef = useRef(onSelect)
  useEffect(() => { onSelectRef.current = onSelect }, [onSelect])
  const handlePress = useCallback((native: string) => onSelectRef.current(native), [])

  const renderItem = useCallback(
    ({ item }: { item: string[] }) => <EmojiRow glyphs={item} onPress={handlePress} />,
    [handlePress],
  )

  const keyExtractor = useCallback((_: string[], index: number) => `${catIndex}:${q}:${index}`, [catIndex, q])

  const listRef = useRef<FlatList<string[]>>(null)
  const pickCategory = useCallback((i: number) => {
    setCatIndex(i)
    listRef.current?.scrollToOffset({ offset: 0, animated: false })
  }, [])

  if (!visible && !everOpened) return null

  return (
    <View style={[s.panel, { height: PANEL_H }, !visible && s.hidden]}>
      {/* grab handle */}
      <View style={s.handle} />

      {/* search */}
      <View style={s.searchRow}>
        <Search size={14} color={C.muted} />
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Search emoji…"
          placeholderTextColor="rgba(255,255,255,0.25)"
          style={s.searchInput}
          autoCorrect={false}
          autoCapitalize="none"
        />
      </View>

      {!q && (
        <View style={s.tabs}>
          {(prepared?.categories ?? []).map((cat, i) => (
            <TouchableOpacity
              key={cat.id}
              onPress={() => pickCategory(i)}
              activeOpacity={0.7}
              style={[s.tab, catIndex === i && s.tabActive]}
            >
              <Text style={s.tabIcon}>{CATEGORY_ICON[cat.id] ?? '🔷'}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {/* grid */}
      {!prepared ? (
        <View style={s.empty}>
          <ActivityIndicator size="small" color={C.cyan} />
        </View>
      ) : rows.length === 0 ? (
        <View style={s.empty}>
          <Text style={s.emptyText}>No emoji found</Text>
        </View>
      ) : (
        <FlatList
          ref={listRef}
          data={rows}
          keyExtractor={keyExtractor}
          renderItem={renderItem}
          style={s.grid}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          // Enough rows to fill the panel at once, then larger batches while scrolling.
          initialNumToRender={Math.ceil(PANEL_H / CELL) + 1}
          maxToRenderPerBatch={8}
          updateCellsBatchingPeriod={16}
          windowSize={11}
          getItemLayout={(_, index) => ({ length: CELL, offset: CELL * index, index })}
        />
      )}
    </View>
  )
}

const s = StyleSheet.create({
  panel:       { backgroundColor: C.bg, paddingHorizontal: 12, paddingTop: 8, borderTopWidth: 1, borderTopColor: C.border },
  hidden:      { display: 'none' },
  handle:      { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.18)', marginBottom: 10 },

  searchRow:   { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: C.field, borderWidth: 1, borderColor: C.border, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8, marginBottom: 8 },
  searchInput: { flex: 1, color: C.white, fontFamily: FONTS.alegreyaSans.regular, fontSize: 14, padding: 0 },

  tabs:        { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4, marginBottom: 4, borderBottomWidth: 1, borderBottomColor: C.border },
  tab:         { width: 34, height: 34, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  tabActive:   { backgroundColor: C.active },
  tabIcon:     { fontFamily: FONTS.alegreyaSans.regular, fontSize: 18 },

  grid:        { flex: 1 },
  row:         { flexDirection: 'row', height: CELL },
  cell:        { width: CELL, height: CELL, lineHeight: CELL, fontSize: 26, textAlign: 'center', textAlignVertical: 'center' },

  empty:       { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyText:   { color: 'rgba(255,255,255,0.25)', fontFamily: FONTS.alegreyaSans.regular, fontSize: 13 },
})
