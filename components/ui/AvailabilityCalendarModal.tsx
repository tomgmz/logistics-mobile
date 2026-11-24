import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Modal,
  View,
  Text,
  Pressable,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
  BackHandler,
} from 'react-native'
import { MotiView, AnimatePresence } from 'moti'
import { Easing } from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { ChevronLeft, ChevronRight, X } from 'lucide-react-native'

import { useAvailabilityStore } from '../../lib/store/availability.store'
import { PencilCheckIcon } from './icons/AvailabilityIcons'
import { ConfirmDialog } from './ConfirmDialog'

/**
 * The month calendar behind the availability pill (Figma node 2877:221,
 * "Your Availability").
 *
 * The pill answers "am I taking work right now"; this answers "which days this
 * month can I be given a delivery", which is the question operations actually
 * schedules against. It opens upward from the pill and covers it, because it is
 * the same control expanded — not a separate screen.
 *
 * Which days can be changed is the server's rule (`editable` on the month read),
 * and every other day is drawn in the muted grey the design uses:
 *   - days already past (the driver cannot re-plan yesterday);
 *   - this week (Sunday to Saturday) once it has a set day: it is fixed, and the
 *     driver calls the Operations Manager to drop a day;
 *   - next month, except its first week from this month's second-to-last week
 *     on. Then a ‹ › pair by the month name pages to next month, where only
 *     that first week can be ticked. One draft covers both pages; one save
 *     sends both months.
 * Sundays are tickable — transit runs seven days a week.
 *
 * A ticked day is a circle once it is saved and a square while it is only in
 * the draft, so the driver can see what still needs saving. The X discards the
 * draft (after asking, if anything changed); every other way out saves it.
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
  error:    '#f62626',
}

const WEEKDAYS = ['S', 'M', 'T', 'W', 'TH', 'F', 'S']
const MONTHS   = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

/** 'YYYY-MM-DD' for a local calendar date, without going through UTC. */
function toDay(year: number, month: number, day: number): string {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/** The Sunday that starts `day`'s calendar row, as 'YYYY-MM-DD'. */
function weekStartOf(day: string): string {
  const d = new Date(`${day}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - d.getUTCDay())
  return d.toISOString().slice(0, 10)
}

function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

interface Cell {
  key:     string
  /** null on the leading/trailing days of the neighbouring months. */
  day:     string | null
  label:   number
  weekday: number
  /** Month index of `label`, for the screen-reader label. */
  monthIndex: number
}

/** Weeks of cells, Sunday-first, with the neighbouring months filled in (grey). */
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
      cells.push({ key: `lead-${i}`, day: null, label: daysBefore + offset + 1, weekday, monthIndex: (month + 11) % 12 })
    } else if (offset >= daysInMonth) {
      cells.push({ key: `trail-${i}`, day: null, label: offset - daysInMonth + 1, weekday, monthIndex: (month + 1) % 12 })
    } else {
      const label = offset + 1
      cells.push({ key: toDay(year, month, label), day: toDay(year, month, label), label, weekday, monthIndex: month })
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
  const editableDays = useAvailabilityStore((s) => s.editable)
  const weekLocked  = useAvailabilityStore((s) => s.weekLocked)
  const nextMonth   = useAvailabilityStore((s) => s.next)
  const loadingDays = useAvailabilityStore((s) => s.loadingDays)
  const savingDays  = useAvailabilityStore((s) => s.savingDays)
  const error       = useAvailabilityStore((s) => s.error)
  const loadDays    = useAvailabilityStore((s) => s.loadDays)
  const saveDays    = useAvailabilityStore((s) => s.saveDays)

  // The driver edits a draft, so a half-finished month never reaches the server
  // and a reload mid-edit doesn't yank days out from under their thumb.
  const [draft, setDraft] = useState<string[]>([])
  const [dirty, setDirty] = useState(false)
  // Which "are you sure" card is up over the calendar: saving, or discarding.
  const [confirming, setConfirming] = useState<'save' | 'discard' | null>(null)
  // Which month page is showing: this month, or next month (only while next
  // month's first week is open). One draft covers both; one save sends both.
  const [onNextPage, setOnNextPage] = useState(false)

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
    setConfirming(null)
    setOnNextPage(false)
    void loadDays(monthKey)
  }, [open, monthKey, loadDays])

  // Fold server state into the draft until the driver starts editing.
  useEffect(() => {
    if (!open || dirty) return
    if (storedMonth === monthKey) setDraft([...storedDays, ...(nextMonth?.days ?? [])].sort())
  }, [open, dirty, storedDays, storedMonth, monthKey, nextMonth])

  // Next month's first week rides on this month's draft; a save splits it again.
  const nextKey   = nextMonth?.month ?? null
  const draftThis = useMemo(() => draft.filter((d) => d.startsWith(monthKey)), [draft, monthKey])
  const draftNext = useMemo(
    () => (nextKey ? draft.filter((d) => d.startsWith(nextKey)) : []),
    [draft, nextKey],
  )

  /**
   * The actual write. Only reached once the driver has said yes.
   *
   * Optimistic: the store keeps the ticks the driver just made, and a failed
   * save surfaces the next time the calendar opens and re-reads the month.
   */
  const performCommit = useCallback(() => {
    const before      = nextMonth?.days ?? []
    const nextChanged = !!nextMonth
      && (before.length !== draftNext.length || draftNext.some((d) => !before.includes(d)))
    void saveDays(monthKey, draftThis, nextChanged ? draftNext : null).catch(() => {})
    setDirty(false)
    setConfirming(null)
    onClose()
  }, [draftThis, draftNext, nextMonth, monthKey, saveDays, onClose])

  /** The X: leave without saving. The next open re-reads the saved month. */
  const performDiscard = useCallback(() => {
    setDirty(false)
    setConfirming(null)
    onClose()
  }, [onClose])

  const requestDiscard = useCallback(() => {
    if (!dirty) { onClose(); return }
    setConfirming('discard')
  }, [dirty, onClose])

  /**
   * Every way out of the calendar comes through here, and a changed month is
   * never written without being confirmed first.
   *
   * The ticks are a commitment, not a preference: operations crews bookings from
   * exactly these days, and the driver is expected to be at the origin at call
   * time on each one. A schedule should not be set by a stray tap on the
   * backdrop or a hardware back press — which is what all three paths used to
   * do silently.
   *
   * An untouched month has nothing to confirm, so it just closes.
   */
  const requestCommit = useCallback(() => {
    if (!dirty) { onClose(); return }
    setConfirming('save')
  }, [dirty, onClose])

  useEffect(() => {
    if (!open) return
    const sub = BackHandler.addEventListener('hardwareBackPress', () => { requestCommit(); return true })
    return () => sub.remove()
  }, [open, requestCommit])

  const hasNext  = storedMonth === monthKey && !!nextMonth
  // Next month closed under the driver (a reload): back to this month.
  const showingNext = onNextPage && hasNext
  const viewYear  = showingNext ? Number(nextMonth!.month.slice(0, 4)) : year
  const viewMonth = showingNext ? Number(nextMonth!.month.slice(5, 7)) - 1 : month
  const cells    = useMemo(() => buildMonth(viewYear, viewMonth), [viewYear, viewMonth])
  const selected = useMemo(() => new Set(draft), [draft])
  // What the server holds — those ticks are circles; draft-only ticks are squares.
  const saved    = useMemo(
    () => new Set(storedMonth === monthKey ? [...storedDays, ...(nextMonth?.days ?? [])] : []),
    [storedDays, storedMonth, monthKey, nextMonth],
  )
  // The server's rule for what can change now. An older backend sends none:
  // then it is this month, today onward, as before.
  const editableSet = useMemo(
    () => (editableDays == null ? null : new Set([...editableDays, ...(nextMonth?.editable ?? [])])),
    [editableDays, nextMonth],
  )
  const canEdit = (day: string) => (editableSet
    ? editableSet.has(day)
    : day.startsWith(monthKey) && day >= today)

  const weekFrom = weekStartOf(today)
  const weekTo   = addDays(weekFrom, 6)
  const nextName = nextMonth ? MONTHS[Number(nextMonth.month.slice(5, 7)) - 1] : null

  // Says what confirming actually does, in the driver's terms. Clearing the
  // month is called out separately: it is the one answer that takes them out of
  // the assignable pool entirely, and it looks identical to a stray tap.
  const confirmMessage = useMemo(() => {
    const label = `${MONTHS[month]} ${year}`
    if (draft.length === 0) {
      return `You are clearing every day in ${label}. You will not be assignable to any delivery until you tick a day.`
    }
    // Saving a day in this week fixes the week; say so before it happens.
    const fixesWeek = !weekLocked && draft.some((d) => d >= today && d >= weekFrom && d <= weekTo)
    const plural    = (n: number) => `${n} day${n === 1 ? '' : 's'}`
    const nextPart  = draftNext.length > 0 && nextName
      ? ` and ${plural(draftNext.length)} in the first week of ${nextName}`
      : ''
    return `You can be assigned a delivery on ${plural(draftThis.length)} in ${label}${nextPart}. `
      + 'The Operations Manager can assign you on any of them.'
      + (fixesWeek ? ' Once saved, this week is fixed and cannot be changed in the app.' : '')
  }, [draft, draftThis, draftNext, nextName, month, year, weekLocked, weekFrom, weekTo, today])

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
      onRequestClose={requestCommit}
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
              onPress={requestCommit}
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
              {/* The same title slot as the pill it grew out of. */}
              <View style={styles.header}>
                <TouchableOpacity
                  onPress={requestDiscard}
                  disabled={savingDays}
                  hitSlop={12}
                  accessibilityRole="button"
                  accessibilityLabel="Close without saving"
                  activeOpacity={0.6}
                >
                  <X size={16} color={COLORS.cyan} strokeWidth={2.4} />
                </TouchableOpacity>

                <View style={styles.headerText}>
                  <Text style={styles.title}>Your Availability</Text>
                  <Text style={styles.subtitle}>
                    Select the days you can be assigned to a delivery.
                  </Text>
                </View>

                {savingDays ? (
                  <ActivityIndicator size="small" color={COLORS.cyan} />
                ) : (
                  <TouchableOpacity
                    onPress={requestCommit}
                    hitSlop={12}
                    accessibilityRole="button"
                    accessibilityLabel="Save your availability"
                    activeOpacity={0.6}
                  >
                    <PencilCheckIcon size={16} color={COLORS.cyan} />
                  </TouchableOpacity>
                )}
              </View>

              <View style={styles.monthRow}>
                <Text style={styles.month}>{MONTHS[viewMonth]} {viewYear}</Text>
                {loadingDays && <ActivityIndicator size="small" color={COLORS.muted} />}

                {/* Only while next month's first week is open: this month ‹ › next. */}
                {hasNext && (
                  <View style={styles.monthNav}>
                    <TouchableOpacity
                      onPress={() => setOnNextPage(false)}
                      disabled={!showingNext}
                      hitSlop={10}
                      accessibilityRole="button"
                      accessibilityLabel={`Show ${MONTHS[month]}`}
                      accessibilityState={{ disabled: !showingNext }}
                      activeOpacity={0.6}
                      style={styles.monthNavButton}
                    >
                      <ChevronLeft size={20} color={showingNext ? COLORS.cyan : COLORS.dim} strokeWidth={2.4} />
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => setOnNextPage(true)}
                      disabled={showingNext}
                      hitSlop={10}
                      accessibilityRole="button"
                      accessibilityLabel={`Show ${nextName}`}
                      accessibilityState={{ disabled: showingNext }}
                      activeOpacity={0.6}
                      style={styles.monthNavButton}
                    >
                      <ChevronRight size={20} color={showingNext ? COLORS.dim : COLORS.cyan} strokeWidth={2.4} />
                    </TouchableOpacity>
                  </View>
                )}
              </View>

              <View style={styles.grid}>
                <View style={styles.week}>
                  {WEEKDAYS.map((label, index) => (
                    <View key={`weekday-${index}`} style={styles.cell}>
                      <Text style={styles.weekday}>
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
                      const editable   = cell.day != null && canEdit(cell.day)
                      const isSaved    = isSelected && saved.has(cell.day!)
                      const shape      = !isSelected ? 'plain' : isSaved ? 'saved' : 'draft'

                      return (
                        <Pressable
                          key={cell.key}
                          style={styles.cell}
                          disabled={!editable}
                          onPress={() => { if (cell.day) toggle(cell.day) }}
                          accessibilityRole={editable ? 'checkbox' : undefined}
                          accessibilityState={{ checked: isSelected, disabled: !editable }}
                          accessibilityLabel={cell.day
                            ? `${MONTHS[cell.monthIndex]} ${cell.label}${editable ? '' : ', not selectable'}`
                            : undefined}
                        >
                          {({ pressed }) => (
                            // Keyed on its shape so Android redraws it from scratch: a
                            // background added to an already-drawn view can lose its
                            // rounded corners, which made saved days square on the
                            // first open (they arrive from the server after mount).
                            <View
                              key={shape}
                              style={[
                                styles.dayCircle,
                                isSelected && styles.dayCircleSelected,
                                shape === 'draft' && styles.daySquare,
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

              {weekLocked && (
                <Text style={styles.note}>
                  This week is fixed because you already have days set in it. Call the Operations
                  Manager if you cannot work a day you set.
                </Text>
              )}
              {hasNext && nextName && (
                <Text style={styles.note}>
                  {showingNext
                    ? `Only the first week of ${nextName} can be set now. The rest of ${nextName} opens on ${nextName} 1.`
                    : `You can now set the first week of ${nextName}. Tap › to go to ${nextName}.`}
                </Text>
              )}

              {!!error && <Text style={styles.error}>{error}</Text>}
            </MotiView>
          </MotiView>
        )}
      </AnimatePresence>

      {/* Sits over the calendar rather than replacing it, so the driver can read
          back the days they ticked while answering. */}
      <ConfirmDialog
        visible={confirming === 'save'}
        title="CONFIRM YOUR SCHEDULE"
        message={confirmMessage}
        confirmLabel="Confirm"
        cancelLabel="Back"
        tone="cyan"
        busy={savingDays}
        onConfirm={performCommit}
        onCancel={() => setConfirming(null)}
      />

      <ConfirmDialog
        visible={confirming === 'discard'}
        title="DISCARD YOUR CHANGES?"
        message={`The days you changed${hasNext && nextName ? ` in ${MONTHS[month]} and ${nextName}` : ` in ${MONTHS[month]} ${year}`} will not be saved. Your schedule stays as it was.`}
        confirmLabel="Discard"
        cancelLabel="Keep editing"
        tone="red"
        onConfirm={performDiscard}
        onCancel={() => setConfirming(null)}
      />
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
    gap:           10,
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
  monthNav: {
    flexDirection: 'row',
    alignItems:    'center',
    gap:           4,
    marginLeft:    'auto',
    marginRight:   9,
  },
  monthNavButton: {
    width:          32,
    height:         32,
    alignItems:     'center',
    justifyContent: 'center',
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
  // Ticked but not saved yet.
  daySquare:        { borderRadius: 4 },
  dayCirclePressed: { backgroundColor: 'rgba(255,255,255,0.10)' },

  day: {
    color:      COLORS.white,
    fontSize:   14,
    fontWeight: '500',
  },
  dayMuted:    { color: COLORS.dim },
  daySelected: { color: COLORS.selected, fontWeight: '700' },

  note: {
    color:            COLORS.muted,
    fontSize:         12,
    lineHeight:       14,
    marginTop:        10,
    marginHorizontal: 13,
  },

  error: {
    color:            COLORS.error,
    fontSize:         12,
    marginTop:        10,
    marginHorizontal: 13,
  },
})
