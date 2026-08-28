import React, { useState } from 'react'
import { View, Text, Pressable } from 'react-native'
import { Power } from 'lucide-react-native'

import { useAvailabilityStore } from '../../lib/store/availability.store'
import AvailabilityCalendarModal from './AvailabilityCalendarModal'
import { PencilUpIcon } from './icons/AvailabilityIcons'

/**
 * Where the driver says when they can work — and what that adds up to today.
 *
 * The days ticked on the calendar are the whole of the driver's opt-in:
 * operations can put them on a booking scheduled for a ticked day and on no
 * other. So this pill is a readout, not a switch. It used to be a switch, and
 * the pair could disagree — a driver switched "available" with no days ticked
 * got nothing, and could not see why. One control, one answer.
 *
 * It stays docked at the bottom of the landing page because the calendar behind
 * it is the one thing that decides whether the driver gets work at all: it
 * should be reachable by thumb the moment they open the app.
 */
export default function AvailabilityToggle() {
  const [calendarOpen, setCalendarOpen] = useState(false)

  const status     = useAvailabilityStore((s) => s.status)
  const onDelivery = useAvailabilityStore((s) => s.onDelivery)
  const days       = useAvailabilityStore((s) => s.days)
  const today      = useAvailabilityStore((s) => s.today)

  const blocked  = status === 'on_leave' || status === 'inactive'
  // The calendar is only loaded once it has been opened, so "no days yet" is not
  // proof of anything until we know what today is on the server's clock.
  const known    = today != null
  const workingToday = known && days.includes(today)

  const label = onDelivery ? 'On delivery'
    : blocked ? (status === 'on_leave' ? 'On leave' : 'Inactive')
    : !known ? 'Your availability'
    : workingToday ? 'Available today'
    : 'Not working today'

  const hint = onDelivery ? 'Locked until this delivery is done'
    : blocked ? 'Contact operations to change this'
    : !known ? 'Tap to pick the days you can work'
    : workingToday ? 'You can be given a delivery today'
    : 'Tap to pick the days you can work'

  const tone = onDelivery ? { bg: 'bg-blue-950',    dot: 'bg-blue-400',    text: 'text-blue-400'    }
    : blocked            ? { bg: 'bg-zinc-800',     dot: 'bg-zinc-500',    text: 'text-zinc-400'    }
    : workingToday       ? { bg: 'bg-emerald-950',  dot: 'bg-emerald-400', text: 'text-emerald-400' }
    :                      { bg: 'bg-amber-950',    dot: 'bg-amber-400',   text: 'text-amber-400'   }

  return (
    <>
    {/* The whole pill opens the calendar — it is the only thing here to do, so
        there is no smaller target to hunt for. */}
    <Pressable
      onPress={() => setCalendarOpen(true)}
      accessibilityRole="button"
      accessibilityLabel={`${label}. Set the days you can be assigned to a delivery`}
      accessibilityHint="Opens your availability calendar"
      style={({ pressed }) => ({ opacity: pressed ? 0.75 : 1 })}
      className={`flex-row items-center gap-3 rounded-2xl px-4 py-3 ${tone.bg}`}
    >
      <View className={`w-2.5 h-2.5 rounded-full ${tone.dot}`} />

      <View className="flex-1">
        <Text className={`text-sm font-bold ${tone.text}`}>{label}</Text>
        <Text className="text-[11px] text-ink-faint mt-0.5">{hint}</Text>
      </View>

      <Power size={18} color="#818181" />
      <PencilUpIcon size={16} color="#4df9ed" />
    </Pressable>

    <AvailabilityCalendarModal open={calendarOpen} onClose={() => setCalendarOpen(false)} />
    </>
  )
}
