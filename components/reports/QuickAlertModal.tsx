import React, { useCallback, useEffect, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Animated,
  Modal,
  PanResponder,
  Pressable,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'
import { ChevronRight, X } from 'lucide-react-native'

import { FONTS } from '../../lib/config/fonts'
import { createReport, type IncidentType } from '../../lib/api/reports.api'
import { IncidentTypeGrid } from './IncidentTypeGrid'
import { ReportDetailsPanel } from './ReportDetailsPanel'
import { useReportContext } from '../../hooks/useReportContext'

/**
 * QUICK ALERT — the SOS.
 *
 * The design of this screen is one decision: the alert goes out whether or not
 * the driver does anything else. A twenty-second countdown starts the moment it
 * opens and sends on its own when it reaches zero, because the situations this
 * exists for are exactly the ones where the driver stops being able to use their
 * phone. Picking an incident type is optional and only adds context; an alert
 * sent without one is logged as an unspecified emergency, which is worth far
 * more than an alert never sent because the driver could not decide.
 *
 * The countdown is also why CANCEL is the plain, easy target and SEND is a
 * SWIPE. The two gestures are not symmetrical and must not be: stopping a false
 * alarm has to be instant, because the driver has seconds to do it, while
 * sending EARLY is a deliberate act — a phone loose in a truck cab should not be
 * able to page the whole operations team ahead of schedule.
 */

const D = {
  sheet:   '#0a0a0a',
  inner:   '#1b1b1b',
  line:    '#424242',
  white:   '#ffffff',
  faint:   '#818181',
  cyan:    '#4df9ed',
  red:     '#f62626',
  overlay: 'rgba(0,0,0,0.8)',
}

/** Seconds before the alert sends itself. */
const COUNTDOWN_S = 20

/** Fraction of the track the thumb must cross for the swipe to count. */
const SWIPE_COMMIT = 0.62

// Geometry from the design (node 2968:402): CANCEL 66×35, a 5px gap, then a
// 208×35 track carrying a 58×33 thumb inset by 1. The track itself flexes to
// the screen; everything else is fixed, because a thumb that grows with the
// screen stops reading as a thing you drag.
const TRACK_H   = 35
const THUMB_W   = 58
const CANCEL_W  = 66
const TRACK_GAP = 5

interface Props {
  visible:    boolean
  bookingId?: string | null
  /** Booking reference and date, for the header line. */
  contextRef?:  string | null
  contextDate?: string | null
  onSent:    (reportId: string) => void
  onCancel:  () => void
  /** "Report with details instead" — hands off to the full form. */
  onDetailed: () => void
}

export function QuickAlertModal({
  visible, bookingId, contextRef, contextDate, onSent, onCancel, onDetailed,
}: Props) {
  const ctx = useReportContext(visible ? bookingId : null)

  const [type, setType]       = useState<IncidentType | null>(null)
  const [seconds, setSeconds] = useState(COUNTDOWN_S)
  const [sending, setSending] = useState(false)
  const [error, setError]     = useState<string | null>(null)

  const sentRef  = useRef(false)
  const typeRef  = useRef<IncidentType | null>(null)
  const trackW   = useRef(0)
  const slide    = useRef(new Animated.Value(0)).current

  // The interval's send closure is created once per opening, so it must not
  // capture `type` — the driver picks a tile mid-countdown and that choice has
  // to reach the send that fires afterwards.
  useEffect(() => { typeRef.current = type }, [type])

  const send = useCallback(async () => {
    if (sentRef.current) return
    sentRef.current = true
    setSending(true)
    setError(null)

    try {
      const report = await createReport({
        source:        'quick',
        booking_id:    bookingId ?? null,
        incident_type: typeRef.current,
        latitude:      ctx.latitude,
        longitude:     ctx.longitude,
        accuracy_m:    ctx.accuracy_m,
        address:       ctx.address,
      })
      onSent(report.report_id)
    } catch (e: any) {
      // Let the driver try again rather than swallowing it: this is the one
      // request in the app where silent failure is unacceptable.
      sentRef.current = false
      setError(
        e?.response?.data?.message ??
        'The alert could not be sent. Check your signal and swipe again.',
      )
      Animated.spring(slide, { toValue: 0, useNativeDriver: true }).start()
    } finally {
      setSending(false)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookingId, ctx.latitude, ctx.longitude, ctx.accuracy_m, ctx.address, onSent])

  // Every opening starts clean — no carried-over tile, error, or half-dragged
  // thumb from the last time — and restarts the countdown.
  useEffect(() => {
    if (!visible) return
    sentRef.current = false
    setType(null)
    setSeconds(COUNTDOWN_S)
    setError(null)
    setSending(false)
    slide.setValue(0)

    const id = setInterval(() => {
      setSeconds((n) => {
        if (n <= 1) {
          clearInterval(id)
          void send()
          return 0
        }
        return n - 1
      })
    }, 1000)

    return () => clearInterval(id)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible])

  const pan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dx) > 4,
      onPanResponderMove: (_e, g) => {
        const max = Math.max(trackW.current - THUMB_W - 2, 1)
        slide.setValue(Math.max(0, Math.min(g.dx, max)))
      },
      onPanResponderRelease: (_e, g) => {
        const max = Math.max(trackW.current - THUMB_W - 2, 1)
        if (g.dx >= max * SWIPE_COMMIT) {
          Animated.timing(slide, { toValue: max, duration: 120, useNativeDriver: true }).start()
          void send()
        } else {
          Animated.spring(slide, { toValue: 0, useNativeDriver: true }).start()
        }
      },
    }),
  ).current

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={{
        flex: 1, backgroundColor: D.overlay,
        alignItems: 'center', justifyContent: 'center', padding: 16,
      }}>
        <Pressable
          onPress={() => {}}
          style={{
            width: '100%', maxWidth: 340,
            backgroundColor: D.sheet,
            borderWidth: 0.5, borderColor: D.line,
            borderRadius: 15, padding: 16, gap: 14,
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: D.white, fontSize: 22, fontFamily: FONTS.spartan.bold }}>
                QUICK ALERT
              </Text>
              {(contextRef || contextDate) && (
                <Text style={{ color: D.faint, fontSize: 12, marginTop: 2, fontFamily: FONTS.spartan.medium }}>
                  {contextRef ? <Text style={{ color: D.cyan }}>for {contextRef}</Text> : null}
                  {contextRef && contextDate ? '  ·  ' : ''}
                  {contextDate ?? ''}
                </Text>
              )}
            </View>
            <TouchableOpacity onPress={onCancel} hitSlop={10} accessibilityRole="button" accessibilityLabel="Close">
              <X size={20} color={D.faint} />
            </TouchableOpacity>
          </View>

          <ReportDetailsPanel ctx={ctx} />

          <View style={{ gap: 3 }}>
            <Text style={{ color: D.white, fontSize: 13, letterSpacing: 0.5, fontFamily: FONTS.spartan.bold }}>
              TYPE OF INCIDENT
            </Text>
            <Text style={{ color: D.faint, fontSize: 11, fontFamily: FONTS.spartan.medium }}>
              Tap one to add context (optional) — sending in{' '}
              <Text style={{ color: seconds <= 5 ? D.red : D.cyan, fontFamily: FONTS.spartan.bold }}>
                {seconds} second{seconds === 1 ? '' : 's'}
              </Text>
            </Text>
          </View>

          <IncidentTypeGrid value={type} onChange={setType} compact disabled={sending} />

          <Text style={{ color: D.faint, fontSize: 11, lineHeight: 15, fontFamily: FONTS.spartan.medium }}>
            If none is selected, this will be logged as an “Unspecified Emergency”.
          </Text>

          <TouchableOpacity
            onPress={onDetailed}
            accessibilityRole="button"
            style={{ alignSelf: 'flex-end', flexDirection: 'row', alignItems: 'center', gap: 2 }}
          >
            <Text style={{ color: D.cyan, fontSize: 11, fontFamily: FONTS.spartan.medium }}>
              Report with Details instead
            </Text>
            <ChevronRight size={13} color={D.cyan} />
          </TouchableOpacity>

          {error ? (
            <Text style={{ color: D.red, fontSize: 12, lineHeight: 16, fontFamily: FONTS.spartan.medium }}>
              {error}
            </Text>
          ) : null}

          {/* Action row, per the design: a fixed CANCEL pill, then the swipe
              track. The SEND thumb sits INSIDE the track at its left edge with
              the instruction to its right — not centred underneath the thumb —
              so the label stays readable until the thumb actually covers it. */}
          <View style={{ flexDirection: 'row', gap: TRACK_GAP, alignItems: 'center' }}>
            <TouchableOpacity
              onPress={onCancel}
              disabled={sending}
              activeOpacity={0.75}
              accessibilityRole="button"
              accessibilityLabel="Cancel the alert"
              style={{
                width: CANCEL_W, height: TRACK_H,
                borderRadius: 10, borderWidth: 1, borderColor: D.line,
                alignItems: 'center', justifyContent: 'center',
              }}
            >
              <Text style={{ color: D.faint, fontSize: 13, fontFamily: FONTS.spartan.bold }}>CANCEL</Text>
            </TouchableOpacity>

            <View
              onLayout={(e) => { trackW.current = e.nativeEvent.layout.width }}
              style={{
                flex: 1, height: TRACK_H, borderRadius: 10,
                backgroundColor: D.inner, borderWidth: 0.5, borderColor: D.line,
                justifyContent: 'center', overflow: 'hidden',
              }}
            >
              {/* Fades out as the thumb travels over it. */}
              <Animated.View
                style={{
                  position: 'absolute', left: THUMB_W + 7, right: 8,
                  flexDirection: 'row', alignItems: 'center', gap: 6,
                  opacity: slide.interpolate({
                    inputRange:  [0, 60],
                    outputRange: [1, 0],
                    extrapolate: 'clamp',
                  }),
                }}
              >
                <Text
                  numberOfLines={1}
                  style={{ color: D.faint, fontSize: 12, fontFamily: FONTS.spartan.medium }}
                >
                  Swipe to confirm
                </Text>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  {[0, 1, 2, 3, 4].map((i) => (
                    <ChevronRight key={i} size={11} color={D.faint} style={{ marginLeft: -3, opacity: 0.55 }} />
                  ))}
                </View>
              </Animated.View>

              <Animated.View
                {...pan.panHandlers}
                accessibilityRole="adjustable"
                accessibilityLabel="Swipe to send the emergency alert"
                style={{
                  position: 'absolute', left: 1, top: 1, bottom: 1, width: THUMB_W,
                  backgroundColor: D.cyan,
                  alignItems: 'center', justifyContent: 'center',
                  borderRadius: 9,
                  transform: [{ translateX: slide }],
                }}
              >
                {sending
                  ? <ActivityIndicator size="small" color="#000" />
                  : <Text style={{ color: '#000', fontSize: 13, fontFamily: FONTS.spartan.bold }}>SEND</Text>}
              </Animated.View>
            </View>
          </View>
        </Pressable>
      </View>
    </Modal>
  )
}
