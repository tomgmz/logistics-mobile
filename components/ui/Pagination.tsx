import React from 'react'
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native'
import { ChevronLeft, ChevronRight } from 'lucide-react-native'

/**
 * Numbered pagination, the driver-app twin of the web's components/ui/Pagination:
 * the range shown ("11–20 of 57") on its own line, then Previous, the page
 * numbers with ellipses for long runs (1 … 5 … 12, kept short to fit a phone),
 * and Next.
 */

const C = {
  cyan:   '#4df9ed',
  bg:     '#0a0a0a',
  white:  '#ffffff',
  muted:  '#818181',
  border: '#2a2a2a',
}

/** Page numbers to show, with `null` where an ellipsis goes. Always 1 and the last page. */
export function pageItems(page: number, totalPages: number, siblings = 1): (number | null)[] {
  if (totalPages <= 5 + siblings * 2) {
    return Array.from({ length: totalPages }, (_, i) => i + 1)
  }
  const start = Math.max(2, page - siblings)
  const end   = Math.min(totalPages - 1, page + siblings)
  const items: (number | null)[] = [1]
  if (start > 2) items.push(null)
  for (let p = start; p <= end; p++) items.push(p)
  if (end < totalPages - 1) items.push(null)
  items.push(totalPages)
  return items
}

export default function Pagination({
  page, totalPages, total, pageSize, onPageChange, disabled = false,
}: {
  page:         number
  totalPages:   number
  total:        number
  pageSize:     number
  onPageChange: (page: number) => void
  disabled?:    boolean
}) {
  const first = total === 0 ? 0 : (page - 1) * pageSize + 1
  const last  = Math.min(total, page * pageSize)
  const go    = (p: number) => { if (!disabled && p >= 1 && p <= totalPages && p !== page) onPageChange(p) }

  return (
    <View style={s.row}>
      <Text style={s.range}>{total === 0 ? 'No results' : `${first}–${last} of ${total}`}</Text>

      {totalPages > 1 && (
        <View style={s.pages}>
          <TouchableOpacity
            onPress={() => go(page - 1)}
            disabled={disabled || page <= 1}
            style={[s.btn, s.arrow, (disabled || page <= 1) && s.off]}
            accessibilityLabel="Previous page"
            hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
          >
            <ChevronLeft size={15} color={C.white} />
          </TouchableOpacity>

          {pageItems(page, totalPages, 0).map((p, i) =>
            p === null ? (
              <Text key={`gap-${i}`} style={s.gap}>…</Text>
            ) : (
              <TouchableOpacity
                key={p}
                onPress={() => go(p)}
                disabled={disabled}
                style={[s.btn, p === page && s.current]}
                accessibilityLabel={`Page ${p}`}
                accessibilityState={{ selected: p === page }}
              >
                <Text style={[s.num, p === page && s.numCurrent]}>{p}</Text>
              </TouchableOpacity>
            ),
          )}

          <TouchableOpacity
            onPress={() => go(page + 1)}
            disabled={disabled || page >= totalPages}
            style={[s.btn, s.arrow, (disabled || page >= totalPages) && s.off]}
            accessibilityLabel="Next page"
            hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
          >
            <ChevronRight size={15} color={C.white} />
          </TouchableOpacity>
        </View>
      )}
    </View>
  )
}

const s = StyleSheet.create({
  row:        { alignItems: 'center', gap: 8 },
  range:      { color: C.muted, fontSize: 12, fontVariant: ['tabular-nums'] },
  pages:      { flexDirection: 'row', alignItems: 'center', gap: 4 },
  btn:        { minWidth: 32, height: 32, borderRadius: 8, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  arrow:      { borderWidth: 1, borderColor: C.border },
  off:        { opacity: 0.3 },
  current:    { backgroundColor: C.cyan },
  num:        { color: 'rgba(255,255,255,0.7)', fontSize: 13, fontWeight: '700', fontVariant: ['tabular-nums'] },
  numCurrent: { color: C.bg },
  gap:        { color: C.muted, fontSize: 13, paddingHorizontal: 2 },
})
