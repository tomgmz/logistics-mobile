import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Modal,
  View,
  Text,
  Pressable,
  ActivityIndicator,
  StyleSheet,
  BackHandler,
} from 'react-native'
import { MotiView, AnimatePresence } from 'moti'
import { Easing } from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Power } from 'lucide-react-native'

import { useAvailabilityStore } from '../../lib/store/availability.store'
import { PencilCheckIcon } from './icons/AvailabilityIcons'

/**
 * The month calendar behind the availability pill (Figma node 2877:221,
 * "Your Availability").
 *
 * The pill answers "am I taking work right now"; this answers "which days this
 * month can I be given a delivery", which is the question operations actually
 * schedules against. It opens upward from the pill and covers it, because it is
 * the same control expanded — not a separate screen.
 *
 * Three kinds of day cannot be ticked, and all three are drawn in the muted grey
 * the design uses: days outside this month, days already past (the driver cannot
 * re-plan yesterday), and Sundays, which the design treats as a rest day.
 */

const COLORS = {
  card:     '#003632',
  cyan:     '#4df9ed',
  muted:    '#818181',
  dim:      '#424242',
  selected: '#ffea00',
  selectBg: 'rgba(255,234,0,0.19)',
  white:    '#ffffff',
  overlay:  'rgba(0,0,0,0.55)',
  error:    '#ff4d4d',
}

/** Sunday. The calendar cannot express it, so the driver is never asked to. */
const REST_WEEKDAY = 0

const WEEKDAYS = ['S', 'M', 'T', 'W', 'TH', 'F', 'S']
const MONTHS   = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

/** 'YYYY-MM-DD' for a local calendar date, without going through UTC. */
function toDay(year: number, month: number, day: number): string {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

interface Cell {
  key:     string
  /** null on the leading/trailing days of the neighbouring months. */
  day:     string | null
  label:   number
  weekday: number
}

/** Weeks of cells, Sunday-first, with the neighbouring months filled in. */
function buildMonth(year: number, month: number): Cell[] {
  const firstWeekday = new Date(year, month, 1).getDay()
  const daysInMonth  = new Date(year, month + 1, 0).getDate()
  const daysBefore   = new Date(year, month, 0).getDate()

  // Exactly the weeks the month touches — no trailing row of grey for a month
  // that ends on a Saturday.
  const total  = Math.ceil((firstWeekday + daysInMonth) / 7) * 7
  const cells: Cell[] = []

  for (let i = 0; i < total; i++) {
    const offset  = i - firstWeekday
    const weekday = i % 7

    if (offset < 0) {
      cells.push({ key: `lead-${i}`, day: null, label: daysBefore + offset + 1, weekday })
    } else if (offset >= daysInMonth) {
      cells.push({ key: `trail-${i}`, day: null, label: offset - daysInMonth + 1, weekday })
    } else {
      const label = offset + 1
      cells.push({ key: toDay(year, month, label), day: toDay(year, month, label), label, weekday })
    }
  }

  return cells
}

export interface AvailabilityCalendarModalProps {
  open:    boolean
  onClose: () => void
}

export default function AvailabilityCalendarModal({ open, onClose }: AvailabilityCalendarModalProps) {
  const insets = useSafeAreaInsets()

  const storedDays  = useAvailabilityStore((s) => s.days)
  const storedMonth = useAvailabilityStore((s) => s.month)
  const serverToday = useAvailabilityStore((s) => s.today)
  const loadingDays = useAvailabilityStore((s) => s.loadingDays)
  const savingDays  = useAvailabilityStore((s) => s.savingDays)
  const error       = useAvailabilityStore((s) => s.error)
  const loadDays    = useAvailabilityStore((s) => s.loadDays)
  const saveDays    = useAvailabilityStore((s) => s.saveDays)

  // The driver edits a draft, so a half-finished month never reaches the server
  // and a reload mid-edit doesn't yank days out from under their thumb.
  const [draft, setDraft] = useState<string[]>([])
  const [dirty, setDirty] = useState(false)

  const now      = new Date()
  const year     = now.getFullYear()
  const month    = now.getMonth()
  const monthKey = `${year}-${String(month + 1).padStart(2, '0')}`

  // The device clock only decides which month is drawn; whether a day is already
  // past is the server's call, since that is the clock the assignment gate uses.
  const today = serverToday ?? toDay(year, month, now.getDate())

  useEffect(() => {
    if (!open) return
    setDirty(false)
    void loadDays(monthKey)
  }, [open, monthKey, loadDays])

  // Fold server state into the draft until the driver starts editing.
  useEffect(() => {
    if (!open || dirty) return
    if (storedMonth === monthKey) setDraft(storedDays)
  }, [open, dirty, storedDays, storedMonth, monthKey])

  const commit = useCallback(() => {
    if (!dirty) { onClose(); return }
    // Optimistic: the store keeps the ticks the driver just made, and a failed
    // save surfaces the next time the calendar opens and re-reads the month.
    void saveDays(monthKey, draft).catch(() => {})
    setDirty(false)
    onClose()
  }, [dirty, draft, monthKey, saveDays, onClose])

  useEffect(() => {
    if (!open) return
    const sub = BackHandler.addEventListener('hardwareBackPress', () => { commit(); return true })
    return () => sub.remove()
  }, [open, commit])

  const cells    = useMemo(() => buildMonth(year, month), [year, month])
  const selected = useMemo(() => new Set(draft), [draft])

  const toggle = (day: string) => {
    setDirty(true)
    setDraft((current) =>
      current.includes(day) ? current.filter((d) => d !== day) : [...current, day].sort())
  }

  const rows: Cell[][] = []
  for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7))

  return (
    <Modal
      visible={open}
      transparent
      animationType="none"
      statusBarTranslucent
      onRequestClose={commit}
    >
      <AnimatePresence>
        {open && (
          <MotiView
            key="backdrop"
            from={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ type: 'timing', duration: 180 }}
            style={styles.backdrop}
          >
            <Pressable
              style={StyleSheet.absoluteFill}
              onPress={commit}
              accessibilityLabel="Close availability calendar"
            />

            <MotiView
              key="card"
              from={{ opacity: 0, translateY: 24 }}
              animate={{ opacity: 1, translateY: 0 }}
              exit={{ opacity: 0, translateY: 24 }}
              transition={{ type: 'timing', duration: 220, easing: Easing.out(Easing.cubic) }}
              style={[styles.card, { marginBottom: insets.bottom + 12 }]}
            >
              {/* The same power glyph and title slot as the pill it grew out of. */}
              <View style={styles.header}>
                <Power size={16} color={COLORS.cyan} />

                <View style={styles.headerText}>
                  <Text style={styles.title}>Your Availability</Text>
                  <Text style={styles.subtitle}>
                    Select the days you can be assigned to a delivery.
                  </Text>
                </View>

                {savingDays ? (
                  <ActivityIndicator size="small" color={COLORS.cyan} />
                ) : (
                  <Pressable
                    onPress={commit}
                    hitSlop={12}
                    accessibilityRole="button"
                    accessibilityLabel="Save your availability"
                    style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
                  >
                    <PencilCheckIcon size={16} color={COLORS.cyan} />
                  </Pressable>
                )}
              </View>

              <View style={styles.monthRow}>
                <Text style={styles.month}>{MONTHS[month]} {year}</Text>
                {loadingDays && <ActivityIndicator size="small" color={COLORS.muted} />}
              </View>

              <View style={styles.grid}>
                <View style={styles.week}>
                  {WEEKDAYS.map((label, index) => (
                    <View key={`weekday-${index}`} style={styles.cell}>
                      <Text style={[styles.weekday, index === REST_WEEKDAY && styles.weekdayRest]}>
                        {label}
                      </Text>
                    </View>
                  ))}
                </View>

                {rows.map((week, index) => (
                  <View key={`week-${index}`} style={styles.week}>
                    {week.map((cell) => {
                      const isSelected = cell.day != null && selected.has(cell.day)
                      const isPast     = cell.day != null && cell.day < today
                      const editable   = cell.day != null && !isPast && cell.weekday !== REST_WEEKDAY

                      return (
                        <Pressable
                          key={cell.key}
                          style={styles.cell}
                          disabled={!editable}
                          onPress={() => { if (cell.day) toggle(cell.day) }}
                          accessibilityRole={editable ? 'checkbox' : undefined}
                          accessibilityState={{ checked: isSelected, disabled: !editable }}
                          accessibilityLabel={cell.day
                            ? `${MONTHS[month]} ${cell.label}${editable ? '' : ', not selectable'}`
                            : undefined}
                        >
                          {({ pressed }) => (
                            <View
                              style={[
                                styles.dayCircle,
                                isSelected && styles.dayCircleSelected,
                                isSelected && isPast && styles.dayCirclePast,
                                pressed && editable && styles.dayCirclePressed,
                              ]}
                            >
                              <Text
                                style={[
                                  styles.day,
                                  !editable && styles.dayMuted,
                                  isSelected && styles.daySelected,
                                ]}
                              >
                                {cell.label}
                              </Text>
                            </View>
                          )}
                        </Pressable>
                      )
                    })}
                  </View>
                ))}
              </View>

              {!!error && <Text style={styles.error}>{error}</Text>}
            </MotiView>
          </MotiView>
        )}
      </AnimatePresence>
    </Modal>
  )
}

const styles = StyleSheet.create({
  backdrop: {
    flex:            1,
    backgroundColor: COLORS.overlay,
    justifyContent:  'flex-end',
  },

  card: {
    backgroundColor:   COLORS.card,
    borderWidth:       1,
    borderColor:       COLORS.cyan,
    borderRadius:      10,
    marginHorizontal:  24,
    paddingHorizontal: 10,
    paddingTop:        10,
    paddingBottom:     14,
  },

  header: {
    flexDirection: 'row',
    alignItems:    'flex-start',
    gap:           7,
  },
  headerText: { flex: 1 },
  title: {
    color:      COLORS.cyan,
    fontSize:   14,
    fontWeight: '500',
    lineHeight: 16,
  },
  subtitle: {
    color:      COLORS.muted,
    fontSize:   12,
    lineHeight: 14,
    marginTop:  2,
  },

  monthRow: {
    flexDirection: 'row',
    alignItems:    'center',
    gap:           8,
    marginTop:     14,
    paddingLeft:   13,
  },
  month: {
    color:      COLORS.cyan,
    fontSize:   14,
    fontWeight: '500',
  },

  grid: {
    marginTop:         4,
    paddingHorizontal: 13,
  },
  week: { flexDirection: 'row' },
  cell: {
    flex:           1,
    height:         31,
    alignItems:     'center',
    justifyContent: 'center',
  },

  weekday: {
    color:      COLORS.white,
    fontSize:   14,
    fontWeight: '500',
  },
  weekdayRest: { color: COLORS.dim },

  dayCircle: {
    width:          28,
    height:         28,
    borderRadius:   14,
    alignItems:     'center',
    justifyContent: 'center',
  },
  dayCircleSelected: {
    backgroundColor: COLORS.selectBg,
    borderWidth:     0.5,
    borderColor:     COLORS.selected,
  },
  // Days already worked through stay ticked, but read as history, not as a plan.
  dayCirclePast:    { opacity: 0.45 },
  dayCirclePressed: { backgroundColor: 'rgba(255,255,255,0.10)' },

  day: {
    color:      COLORS.white,
    fontSize:   14,
    fontWeight: '500',
  },
  dayMuted:    { color: COLORS.dim },
  daySelected: { color: COLORS.selected, fontWeight: '700' },

  error: {
    color:            COLORS.error,
    fontSize:         12,
    marginTop:        10,
    marginHorizontal: 13,
  },
})
