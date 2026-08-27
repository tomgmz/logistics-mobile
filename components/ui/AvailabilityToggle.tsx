import React, { useState } from 'react'
import { View, Text, TouchableOpacity, Pressable, ActivityIndicator } from 'react-native'
import { Power } from 'lucide-react-native'

import { useAvailabilityStore } from '../../lib/store/availability.store'
import AvailabilityCalendarModal from './AvailabilityCalendarModal'
import { PencilUpIcon } from './icons/AvailabilityIcons'

/**
 * The driver's own on/off switch for delivery work.
 *
 * Operations only sees drivers who have turned this on, so a driver who never
 * flips it never gets assigned — which is deliberate: a new account starts off.
 * While a delivery is in flight the switch reads "On delivery" and is locked;
 * finishing the delivery stands them down and they opt back in from here.
 *
 * It is docked at the bottom of the landing page rather than buried in a list,
 * because it is the one control that decides whether the driver gets work at
 * all — it should be reachable by thumb the moment they open the app.
 *
 * The switch is only about today. The pencil opens the month calendar, where the
 * driver marks which days ahead they can be given a delivery — the same control
 * expanded, which is why it grows out of this pill rather than opening a screen.
 */
export default function AvailabilityToggle() {
  const [calendarOpen, setCalendarOpen] = useState(false)

  const status    = useAvailabilityStore((s) => s.status)
  const canToggle = useAvailabilityStore((s) => s.canToggle)
  const saving    = useAvailabilityStore((s) => s.saving)
  const setStatus = useAvailabilityStore((s) => s.setStatus)

  const isAvailable = status === 'available'
  const onDelivery  = status === 'assigned'
  const blocked     = status === 'on_leave' || status === 'inactive'

  const label = onDelivery ? 'On delivery'
    : blocked ? (status === 'on_leave' ? 'On leave' : 'Inactive')
    : isAvailable ? 'Accepting deliveries'
    : 'Not accepting'

  const hint = onDelivery ? 'Locked until this delivery is done'
    : blocked ? 'Contact operations to change this'
    : isAvailable ? 'Tap to stop receiving bookings'
    : 'Tap to start receiving bookings'

  const tone = onDelivery ? { bg: 'bg-blue-950',    dot: 'bg-blue-400',    text: 'text-blue-400'    }
    : blocked            ? { bg: 'bg-zinc-800',     dot: 'bg-zinc-500',    text: 'text-zinc-400'    }
    : isAvailable        ? { bg: 'bg-emerald-950',  dot: 'bg-emerald-400', text: 'text-emerald-400' }
    :                      { bg: 'bg-amber-950',    dot: 'bg-amber-400',   text: 'text-amber-400'   }

  const disabled = !canToggle || saving || status == null

  return (
    <>
    <TouchableOpacity
      onPress={() => { if (!disabled) void setStatus(isAvailable ? 'unavailable' : 'available').catch(() => {}) }}
      disabled={disabled}
      activeOpacity={0.75}
      accessibilityRole="switch"
      accessibilityState={{ checked: isAvailable, disabled }}
      accessibilityLabel={`Availability: ${label}`}
      accessibilityHint={disabled ? undefined : hint}
      className={`flex-row items-center gap-3 rounded-2xl px-4 py-3 ${tone.bg} ${disabled ? 'opacity-70' : ''}`}
    >
      {saving
        ? <ActivityIndicator size="small" color="#ffffff" />
        : <View className={`w-2.5 h-2.5 rounded-full ${tone.dot}`} />}

      <View className="flex-1">
        <Text className={`text-sm font-bold ${tone.text}`}>{label}</Text>
        <Text className="text-[11px] text-ink-faint mt-0.5">
          {saving ? 'Saving…' : hint}
        </Text>
      </View>

      <Power size={18} color={disabled ? '#818181' : '#ffffff'} />

      {/* Its own target inside the switch: planning the month must not be one
          mis-tap away from standing yourself down. */}
      <Pressable
        onPress={() => setCalendarOpen(true)}
        hitSlop={12}
        accessibilityRole="button"
        accessibilityLabel="Set the days you can be assigned to a delivery"
        style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
      >
        <PencilUpIcon size={16} color="#4df9ed" />
      </Pressable>
    </TouchableOpacity>

    <AvailabilityCalendarModal open={calendarOpen} onClose={() => setCalendarOpen(false)} />
    </>
  )
}
