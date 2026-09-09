import React from 'react'
import { Text, View } from 'react-native'
import { MapPin, Hash, Truck, User } from 'lucide-react-native'

import { FONTS } from '../../lib/config/fonts'
import type { ReportContext } from '../../hooks/useReportContext'

/**
 * The read-only DETAILS block at the top of both report paths.
 *
 * It is the argument for the quick alert existing at all: everything here is
 * already known, so an alert sent with nothing typed still tells operations
 * where the truck is, which truck it is, and who is driving it. Showing it
 * rather than only sending it is what makes that credible to the driver — they
 * can see what is going out under their name.
 */

const D = {
  inner: '#1b1b1b',
  faint: '#818181',
  white: '#ffffff',
}

export function ReportDetailsPanel({ ctx }: { ctx: ReportContext }) {
  return (
    <View style={{ backgroundColor: D.inner, borderRadius: 10, padding: 12, gap: 7 }}>
      <Text style={{ color: D.white, fontSize: 13, letterSpacing: 0.5, fontFamily: FONTS.spartan.bold }}>
        DETAILS
      </Text>

      <Row
        icon={<MapPin size={13} color={D.faint} />}
        label="Location:"
        // "Locating…" rather than an empty line: the driver needs to know the
        // position is coming, not wonder whether it failed.
        value={ctx.address ?? (
          ctx.latitude != null
            ? `${ctx.latitude.toFixed(5)}, ${ctx.longitude!.toFixed(5)}`
            : ctx.locating ? 'Locating…' : 'Unavailable'
        )}
      />
      <Row icon={<Hash  size={13} color={D.faint} />} label="Plate No.:"     value={ctx.plate      ?? '—'} />
      <Row icon={<Truck size={13} color={D.faint} />} label="Vehicle Model:" value={ctx.vehicle    ?? '—'} />
      <Row icon={<User  size={13} color={D.faint} />} label="Driver:"        value={ctx.driverName ?? '—'} />
    </View>
  )
}

function Row({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 7 }}>
      <View style={{ marginTop: 1 }}>{icon}</View>
      <Text style={{ color: D.faint, fontSize: 12, fontFamily: FONTS.spartan.medium }}>{label}</Text>
      <Text
        style={{ color: D.white, fontSize: 12, flex: 1, fontFamily: FONTS.spartan.medium }}
        numberOfLines={2}
      >
        {value}
      </Text>
    </View>
  )
}
