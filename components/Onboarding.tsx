/**
 * First-launch walkthrough: a swipeable set of slides that explains the driver
 * workflow before the sign-in screen is ever shown.
 *
 * It runs once per install. The flag lives in AsyncStorage rather than the auth
 * store on purpose — it belongs to the phone, not to whoever signs in on it, so
 * a second driver sharing a handset is not walked through it again and signing
 * out does not bring it back.
 */
import React, { useCallback, useRef, useState } from 'react'
import {
  Animated,
  FlatList,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Pressable,
  Text,
  View,
  useWindowDimensions,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import AsyncStorage from '@react-native-async-storage/async-storage'
import {
  Truck,
  CalendarCheck,
  ClipboardList,
  Navigation,
  Camera,
  TriangleAlert,
  MessageCircle,
  LucideIcon,
} from 'lucide-react-native'

import { FONTS } from '../lib/config/fonts'

const CYAN  = '#4df9ed'
const MUTED = '#999999'

/** Bump the suffix to show a rewritten walkthrough to everyone once more. */
const ONBOARDING_KEY = 'onboarding_seen_v1'

export async function hasSeenOnboarding(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(ONBOARDING_KEY)) === '1'
  } catch {
    // Unreadable storage should never trap a driver in the walkthrough.
    return true
  }
}

async function markOnboardingSeen(): Promise<void> {
  try {
    await AsyncStorage.setItem(ONBOARDING_KEY, '1')
  } catch {
  }
}

type Slide = {
  key:   string
  Icon:  LucideIcon
  title: string
  body:  string
  tips:  string[]
}

const SLIDES: Slide[] = [
  {
    key:   'welcome',
    Icon:  Truck,
    title: 'Welcome to 8338 Logistics',
    body:  'Your deliveries, routes and reports, all in one app. Here is how a delivery day works.',
    tips:  [
      'Sign in with the account your Administrator gave you',
      'Allow location, camera and notifications when asked',
    ],
  },
  {
    key:   'availability',
    Icon:  CalendarCheck,
    title: 'Set your availability',
    body:  'No delivery reaches you unless you say you can work. The switch sits at the bottom of Home.',
    tips:  [
      'Tap "Your availability" to pick the days you can work',
      'Leave the switch off on days you cannot drive',
    ],
  },
  {
    key:   'assignments',
    Icon:  ClipboardList,
    title: 'Check your assignments',
    body:  'Your current order shows under Active Orders on Home. Tap "See All" for every assignment.',
    tips:  [
      'Open an order to see the client, cargo, vehicle and route',
      'Pull down on any list to refresh it',
    ],
  },
  {
    key:   'navigate',
    Icon:  Navigation,
    title: 'Start navigation',
    body:  'On the scheduled day, open the order and tap "Start Navigation" for turn-by-turn directions.',
    tips:  [
      'Your location is shared with the office while you deliver',
      'Use "Go here next" to change which drop-off you visit first',
    ],
  },
  {
    key:   'proof',
    Icon:  Camera,
    title: 'Confirm every stop',
    body:  'When you arrive at a pickup or drop-off, the app asks you to confirm it with a photo.',
    tips:  [
      'A proof photo is required before a stop can be confirmed',
      'No signal? Your confirmation is saved and sent once you are back online',
    ],
  },
  {
    key:   'reports',
    Icon:  TriangleAlert,
    title: 'Report a problem',
    body:  'Accident, breakdown or delay? Open Reports from Home and tell the office straight away.',
    tips:  [
      'Send a quick alert in an emergency',
      'Or fill in a detailed report with photos',
    ],
  },
  {
    key:   'messages',
    Icon:  MessageCircle,
    title: 'Stay in touch',
    body:  'Messages and notifications live in the top bar, so you never miss an update.',
    tips:  [
      'Chat with the office and with your client during a delivery',
      'Your profile circle holds your account and Sign out',
    ],
  },
]

export default function Onboarding({ onFinish }: { onFinish: () => void }) {
  const { width } = useWindowDimensions()
  const insets    = useSafeAreaInsets()

  const listRef = useRef<FlatList<Slide>>(null)
  const scrollX = useRef(new Animated.Value(0)).current
  const [index, setIndex] = useState(0)

  const isLast = index === SLIDES.length - 1

  const finish = useCallback(async () => {
    await markOnboardingSeen()
    onFinish()
  }, [onFinish])

  const goNext = () => {
    if (isLast) { void finish(); return }
    listRef.current?.scrollToIndex({ index: index + 1, animated: true })
  }

  const onMomentumEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    setIndex(Math.round(e.nativeEvent.contentOffset.x / width))
  }

  return (
    <View className="flex-1 bg-black" style={{ paddingTop: insets.top }}>
      {/* Skip stays in the same corner on every slide but the last, where
          "Get started" already does the same job. */}
      <View className="h-12 flex-row items-center justify-end px-6">
        {!isLast && (
          <Pressable
            onPress={() => void finish()}
            hitSlop={{ top: 10, bottom: 10, left: 12, right: 12 }}
            accessibilityRole="button"
            accessibilityLabel="Skip the introduction"
          >
            {({ pressed }) => (
              <Text
                className={`text-base ${pressed ? 'text-white' : 'text-white/60'}`}
                style={{ fontFamily: FONTS.spartan.medium }}
              >
                Skip
              </Text>
            )}
          </Pressable>
        )}
      </View>

      <Animated.FlatList
        ref={listRef}
        data={SLIDES}
        keyExtractor={(s) => s.key}
        horizontal
        pagingEnabled
        bounces={false}
        showsHorizontalScrollIndicator={false}
        onScroll={Animated.event(
          [{ nativeEvent: { contentOffset: { x: scrollX } } }],
          { useNativeDriver: false },
        )}
        scrollEventThrottle={16}
        onMomentumScrollEnd={onMomentumEnd}
        getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
        renderItem={({ item, index: i }) => (
          <SlideView slide={item} width={width} index={i} scrollX={scrollX} />
        )}
      />

      <View className="px-6" style={{ paddingBottom: insets.bottom + 24 }}>
        <Dots count={SLIDES.length} width={width} scrollX={scrollX} />

        <Pressable
          onPress={goNext}
          accessibilityRole="button"
          accessibilityLabel={isLast ? 'Get started' : 'Next slide'}
          className="mt-8 h-14 items-center justify-center rounded-2xl active:opacity-80"
          style={{ backgroundColor: CYAN }}
        >
          <Text
            className="text-lg text-black"
            style={{ fontFamily: FONTS.spartan.bold }}
          >
            {isLast ? 'Get started' : 'Next'}
          </Text>
        </Pressable>
      </View>
    </View>
  )
}

/* ── Slide ────────────────────────────────────────────────────────────── */

function SlideView({
  slide,
  width,
  index,
  scrollX,
}: {
  slide:   Slide
  width:   number
  index:   number
  scrollX: Animated.Value
}) {
  const { Icon } = slide

  // The icon drifts and the text fades as a slide leaves, so a swipe reads as
  // moving between pages rather than a hard cut.
  const range = [(index - 1) * width, index * width, (index + 1) * width]
  const iconShift = scrollX.interpolate({
    inputRange:  range,
    outputRange: [width * 0.3, 0, -width * 0.3],
    extrapolate: 'clamp',
  })
  const fade = scrollX.interpolate({
    inputRange:  range,
    outputRange: [0, 1, 0],
    extrapolate: 'clamp',
  })

  return (
    <View style={{ width }} className="flex-1 items-center justify-center px-8">
      <Animated.View
        style={{ transform: [{ translateX: iconShift }], opacity: fade }}
        className="mb-10 items-center justify-center"
      >
        {/* Two soft rings behind the icon, the same cyan glow the rest of the
            app uses for anything live. */}
        <View className="absolute h-56 w-56 rounded-full bg-cyan-glow" />
        <View className="absolute h-40 w-40 rounded-full bg-cyan-dim" />
        <View className="h-28 w-28 items-center justify-center rounded-full border border-cyan-border bg-surface-card">
          <Icon size={48} color={CYAN} strokeWidth={1.75} />
        </View>
      </Animated.View>

      <Animated.View style={{ opacity: fade }} className="w-full items-center">
        <Text
          className="text-center text-3xl text-white"
          style={{ fontFamily: FONTS.spartan.bold }}
        >
          {slide.title}
        </Text>
        <Text
          className="mt-4 text-center text-base leading-6"
          style={{ fontFamily: FONTS.spartan.regular, color: MUTED }}
        >
          {slide.body}
        </Text>

        <View className="mt-8 w-full gap-3">
          {slide.tips.map((tip) => (
            <View
              key={tip}
              className="flex-row items-start gap-3 rounded-2xl border border-surface-border bg-surface-card px-4 py-3"
            >
              <View className="mt-[7px] h-2 w-2 rounded-full" style={{ backgroundColor: CYAN }} />
              <Text
                className="flex-1 text-sm leading-5 text-ink-secondary"
                style={{ fontFamily: FONTS.spartan.regular }}
              >
                {tip}
              </Text>
            </View>
          ))}
        </View>
      </Animated.View>
    </View>
  )
}

/* ── Page dots ────────────────────────────────────────────────────────── */

function Dots({
  count,
  width,
  scrollX,
}: {
  count:   number
  width:   number
  scrollX: Animated.Value
}) {
  return (
    <View className="flex-row items-center justify-center gap-2">
      {Array.from({ length: count }, (_, i) => {
        const range = [(i - 1) * width, i * width, (i + 1) * width]
        const dotWidth = scrollX.interpolate({
          inputRange:  range,
          outputRange: [8, 24, 8],
          extrapolate: 'clamp',
        })
        const opacity = scrollX.interpolate({
          inputRange:  range,
          outputRange: [0.3, 1, 0.3],
          extrapolate: 'clamp',
        })
        return (
          <Animated.View
            key={i}
            style={{ width: dotWidth, opacity, backgroundColor: CYAN }}
            className="h-2 rounded-full"
          />
        )
      })}
    </View>
  )
}
