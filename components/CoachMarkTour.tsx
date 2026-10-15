/**
 * Plays a coach mark tour over the current screen: the screen dims, one target
 * at a time is cut out of the dim and ringed in cyan, and a tooltip beside it
 * says what it is for.
 *
 * The tour starts itself the first time `ready` is true (the screen's data has
 * loaded and the targets are laid out) and never again once it has been
 * finished or skipped. A step whose target is not on screen — no active order,
 * a card scrolled out of view — is passed over rather than pointing at nothing.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Modal, Pressable, Text, View, LayoutChangeEvent } from 'react-native'
import Svg, { Path } from 'react-native-svg'
import { MotiView } from 'moti'

import { FONTS } from '../lib/config/fonts'
import { hasSeenTour, markTourSeen, measureTarget, TargetRect } from '../lib/coachMarks'

const CYAN = '#4df9ed'

/** Breathing room between a target and the edge of its cut-out. */
const HOLE_PAD    = 6
const HOLE_RADIUS = 14
/** Gap between the cut-out and the tooltip. */
const TIP_GAP     = 14
/** Let the screen finish its own entrance animations before measuring. */
const START_DELAY = 700

export type CoachStep = {
  target: string
  title:  string
  body:   string
}

type Props = {
  tourId: string
  steps:  CoachStep[]
  ready:  boolean
}

type Shown = { step: CoachStep; rect: TargetRect; number: number; total: number }

export default function CoachMarkTour({ tourId, steps, ready }: Props) {
  const [visible,  setVisible]  = useState(false)
  const [shown,    setShown]    = useState<Shown | null>(null)
  const [screen,   setScreen]   = useState({ width: 0, height: 0 })
  const [tipH,     setTipH]     = useState(0)
  const started   = useRef(false)
  // The steps that had something on screen when the tour began; the counter
  // ("2 of 4") is over these, not over every step the screen defines.
  const playable  = useRef<CoachStep[]>([])
  const position  = useRef(0)

  const finish = useCallback(() => {
    setVisible(false)
    setShown(null)
    void markTourSeen(tourId)
  }, [tourId])

  const show = useCallback(async (from: number) => {
    const list = playable.current
    let i = from
    while (i < list.length) {
      // Re-measured on every step: the layout may have moved since the start.
      const rect = await measureTarget(list[i].target)
      if (rect) {
        position.current = i
        setTipH(0)
        setShown({ step: list[i], rect, number: i + 1, total: list.length })
        return
      }
      // Gone since the tour began: drop it so the count stays "2 of 4", not
      // a jump from 1 to 3.
      list.splice(i, 1)
    }
    finish()
  }, [finish])

  useEffect(() => {
    if (!ready || started.current) return
    started.current = true

    let cancelled = false
    const timer = setTimeout(async () => {
      if (await hasSeenTour(tourId)) return
      const found: CoachStep[] = []
      for (const step of steps) {
        if (await measureTarget(step.target)) found.push(step)
      }
      // Nothing to point at yet is not "seen" — try again on a later visit.
      if (cancelled || found.length === 0) { started.current = false; return }
      playable.current = found
      setVisible(true)
      void show(0)
    }, START_DELAY)

    return () => { cancelled = true; clearTimeout(timer) }
  }, [ready, tourId, steps, show])

  const onRootLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout
    setScreen({ width, height })
  }

  const next = () => {
    if (!shown) return
    if (shown.number >= shown.total) finish()
    else void show(position.current + 1)
  }

  if (!visible) return null

  const hole = shown && screen.height ? holeFor(shown.rect, screen) : null

  // The tooltip goes on whichever side of the target has more room.
  const below = hole ? (screen.height - (hole.y + hole.h)) >= hole.y : true
  const tipTop = hole
    ? below
      ? hole.y + hole.h + TIP_GAP
      : Math.max(16, hole.y - TIP_GAP - tipH)
    : 0

  return (
    <Modal
      visible
      transparent
      animationType="fade"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={finish}
    >
      <View style={{ flex: 1 }} onLayout={onRootLayout}>
        {/* Swallows taps so the screen underneath cannot be used mid-tour. */}
        <Pressable style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}>
          <Svg width="100%" height="100%">
            <Path
              d={dimPath(screen, hole)}
              fill="rgba(0,0,0,0.78)"
              fillRule="evenodd"
            />
          </Svg>
        </Pressable>

        {hole && (
          <MotiView
            key={`ring-${shown?.number}`}
            pointerEvents="none"
            from={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ type: 'timing', duration: 280 }}
            style={{
              position:     'absolute',
              left:         hole.x,
              top:          hole.y,
              width:        hole.w,
              height:       hole.h,
              borderRadius: HOLE_RADIUS,
              borderWidth:  2,
              borderColor:  CYAN,
            }}
          />
        )}

        {shown && hole && (
          <MotiView
            key={`tip-${shown.number}`}
            from={{ opacity: 0, translateY: below ? 8 : -8 }}
            animate={{ opacity: tipH ? 1 : 0, translateY: 0 }}
            transition={{ type: 'timing', duration: 260 }}
            onLayout={(e) => setTipH(e.nativeEvent.layout.height)}
            style={{ position: 'absolute', left: 16, right: 16, top: tipTop }}
            className="rounded-2xl border border-cyan-border bg-surface-card p-4"
          >
            <Text
              className="text-xs text-cyan"
              style={{ fontFamily: FONTS.spartan.semiBold }}
            >
              {shown.number} of {shown.total}
            </Text>
            <Text
              className="mt-1 text-xl text-white"
              style={{ fontFamily: FONTS.spartan.bold }}
            >
              {shown.step.title}
            </Text>
            <Text
              className="mt-1.5 text-sm leading-5 text-ink-secondary"
              style={{ fontFamily: FONTS.spartan.regular }}
            >
              {shown.step.body}
            </Text>

            <View className="mt-4 flex-row items-center justify-between">
              {shown.number < shown.total ? (
                <Pressable
                  onPress={finish}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  accessibilityRole="button"
                  accessibilityLabel="Skip the tour"
                >
                  {({ pressed }) => (
                    <Text
                      className={`text-sm ${pressed ? 'text-white' : 'text-white/60'}`}
                      style={{ fontFamily: FONTS.spartan.medium }}
                    >
                      Skip tour
                    </Text>
                  )}
                </Pressable>
              ) : <View />}

              <Pressable
                onPress={next}
                accessibilityRole="button"
                accessibilityLabel={shown.number < shown.total ? 'Next tip' : 'Finish the tour'}
                className="h-10 items-center justify-center rounded-xl px-5 active:opacity-80"
                style={{ backgroundColor: CYAN }}
              >
                <Text className="text-base text-black" style={{ fontFamily: FONTS.spartan.bold }}>
                  {shown.number < shown.total ? 'Next' : 'Got it'}
                </Text>
              </Pressable>
            </View>
          </MotiView>
        )}
      </View>
    </Modal>
  )
}

type Hole = { x: number; y: number; w: number; h: number }

/** The padded cut-out, kept inside the screen so a tall card still fits. */
function holeFor(rect: TargetRect, screen: { width: number; height: number }): Hole {
  const x  = Math.max(4, rect.x - HOLE_PAD)
  const y  = Math.max(4, rect.y - HOLE_PAD)
  const x2 = Math.min(screen.width - 4,  rect.x + rect.width  + HOLE_PAD)
  const y2 = Math.min(screen.height - 4, rect.y + rect.height + HOLE_PAD)
  return { x, y, w: Math.max(0, x2 - x), h: Math.max(0, y2 - y) }
}

/** Full-screen rectangle with a rounded hole; even-odd fill leaves the hole clear. */
function dimPath(screen: { width: number; height: number }, hole: Hole | null): string {
  const outer = `M0 0 H${screen.width} V${screen.height} H0 Z`
  if (!hole) return outer
  const { x, y, w, h } = hole
  const r = Math.min(HOLE_RADIUS, w / 2, h / 2)
  return (
    outer +
    ` M${x + r} ${y} H${x + w - r} A${r} ${r} 0 0 1 ${x + w} ${y + r}` +
    ` V${y + h - r} A${r} ${r} 0 0 1 ${x + w - r} ${y + h}` +
    ` H${x + r} A${r} ${r} 0 0 1 ${x} ${y + h - r}` +
    ` V${y + r} A${r} ${r} 0 0 1 ${x + r} ${y} Z`
  )
}
