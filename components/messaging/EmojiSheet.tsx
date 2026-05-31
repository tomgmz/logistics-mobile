import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  View, Text, TextInput, TouchableOpacity,
  FlatList, StyleSheet, Dimensions, ActivityIndicator,
} from 'react-native'
import { Search } from 'lucide-react-native'

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

let _data: EmojiDataShape | null = null
let _searchIndex: Record<string, string> | null = null

function loadData(): EmojiDataShape {
  if (!_data) {
    _data = require('@emoji-mart/data') as unknown as EmojiDataShape
  }
  return _data
}

function getSearchIndex(d: EmojiDataShape): Record<string, string> {
  if (!_searchIndex) {
    const idx: Record<string, string> = {}
    for (const id of Object.keys(d.emojis)) {
      const e = d.emojis[id]
      idx[id] = [e.name, ...(e.keywords ?? []), ...(e.emoticons ?? [])]
        .join(' ')
        .toLowerCase()
    }
    _searchIndex = idx
  }
  return _searchIndex
}

function nativeOf(d: EmojiDataShape, id: string): string {
  return d.emojis[id]?.skins[0]?.native ?? ''
}

interface CellProps { native: string; onPress: (e: string) => void }

const EmojiCell = React.memo(function EmojiCell({ native, onPress }: CellProps) {
  return (
    <TouchableOpacity onPress={() => onPress(native)} activeOpacity={0.5} style={s.cell}>
      <Text style={s.cellEmoji}>{native}</Text>
    </TouchableOpacity>
  )
})

interface EmojiSheetProps {
  visible:  boolean
  onClose:  () => void
  onSelect: (emoji: string) => void
}

export default function EmojiSheet({ visible, onSelect }: EmojiSheetProps) {
  const [data, setData]         = useState<EmojiDataShape | null>(_data)
  const [search, setSearch]     = useState('')
  const [catIndex, setCatIndex] = useState(0)

  // never blocked by it.
  useEffect(() => {
    if (visible && !data) {
      const t = setTimeout(() => setData(loadData()), 0)
      return () => clearTimeout(t)
    }
  }, [visible, data])

  const items = useMemo(() => {
    if (!data) return []
    const q = search.trim().toLowerCase()
    let ids: string[]
    if (!q) {
      ids = data.categories[catIndex]?.emojis ?? []
    } else {
      const idx = getSearchIndex(data)
      ids = Object.keys(data.emojis).filter(id => idx[id].includes(q))
    }
    const out: { id: string; native: string }[] = []
    for (const id of ids) {
      const native = nativeOf(data, id)
      if (native) out.push({ id, native })
    }
    return out
  }, [data, search, catIndex])

  const onSelectRef = useRef(onSelect)
  useEffect(() => { onSelectRef.current = onSelect }, [onSelect])
  const handlePress = useCallback((native: string) => onSelectRef.current(native), [])

  const renderItem = useCallback(
    ({ item }: { item: { id: string; native: string } }) => (
      <EmojiCell native={item.native} onPress={handlePress} />
    ),
    [handlePress],
  )

  const keyExtractor = useCallback((item: { id: string }) => item.id, [])

  if (!visible) return null

  return (
    <View style={[s.panel, { height: PANEL_H }]}>
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

      {!search.trim() && (
        <View style={s.tabs}>
          {(data?.categories ?? []).map((cat, i) => (
            <TouchableOpacity
              key={cat.id}
              onPress={() => setCatIndex(i)}
              activeOpacity={0.7}
              style={[s.tab, catIndex === i && s.tabActive]}
            >
              <Text style={s.tabIcon}>{CATEGORY_ICON[cat.id] ?? '🔷'}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {/* grid */}
      {!data ? (
        <View style={s.empty}>
          <ActivityIndicator size="small" color={C.cyan} />
        </View>
      ) : items.length === 0 ? (
        <View style={s.empty}>
          <Text style={s.emptyText}>No emoji found</Text>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={keyExtractor}
          renderItem={renderItem}
          numColumns={COLS}
          style={s.grid}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          removeClippedSubviews
          initialNumToRender={40}
          maxToRenderPerBatch={24}
          updateCellsBatchingPeriod={50}
          windowSize={9}
          getItemLayout={(_, index) => ({
            length: CELL,
            offset: CELL * Math.floor(index / COLS),
            index,
          })}
        />
      )}
    </View>
  )
}

const s = StyleSheet.create({
  panel:       { backgroundColor: C.bg, paddingHorizontal: 12, paddingTop: 8, borderTopWidth: 1, borderTopColor: C.border },
  handle:      { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.18)', marginBottom: 10 },

  searchRow:   { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: C.field, borderWidth: 1, borderColor: C.border, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8, marginBottom: 8 },
  searchInput: { flex: 1, color: C.white, fontSize: 14, padding: 0 },

  tabs:        { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4, marginBottom: 4, borderBottomWidth: 1, borderBottomColor: C.border },
  tab:         { width: 34, height: 34, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  tabActive:   { backgroundColor: C.active },
  tabIcon:     { fontSize: 18 },

  grid:        { flex: 1 },
  cell:        { width: CELL, height: CELL, alignItems: 'center', justifyContent: 'center' },
  cellEmoji:   { fontSize: 26 },

  empty:       { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyText:   { color: 'rgba(255,255,255,0.25)', fontSize: 13 },
})
