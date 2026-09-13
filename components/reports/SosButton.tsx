import React, { useState } from 'react'
import { Text, TouchableOpacity, View } from 'react-native'
import { useRouter } from 'expo-router'

import { FONTS } from '../../lib/config/fonts'
import { ReportOptionModal } from './ReportOptionModal'
import { QuickAlertModal } from './QuickAlertModal'

/**
 * SOS, on the navigation map.
 *
 * The reports list has a floating button that opens the same fork, but a driver
 * having an emergency is not on the reports list — they are on the map, driving.
 * Making them back out of navigation to find the button would put a screen
 * transition between them and the alert, which is the one thing this must never
 * have.
 *
 * Self-contained on purpose: it owns both modals, so dropping it into either
 * provider's overlay costs one line and neither overlay grows report state it
 * would otherwise have to thread through.
 */

const D = {
  red:    '#f62626',
  redDim: 'rgba(246,38,38,0.85)',
  white:  '#ffffff',
}

interface Props {
  bookingId?:   string | null
  contextRef?:  string | null
  contextDate?: string | null
  /** Nudges the button clear of whatever else the overlay has docked. */
  bottom?: number
  right?:  number
  /**
   * Docks the button from the top instead, for overlays that stack it in a
   * column with their own controls. Wins over `bottom` when both are given.
   */
  top?: number
  /** The disc's diameter, for lining up with a column of a different size. */
  size?: number
}

export function SosButton({
  bookingId, contextRef, contextDate, bottom = 150, right = 14, top, size = 52,
}: Props) {
  const router = useRouter()
  const [optionsOpen, setOptionsOpen] = useState(false)
  const [quickOpen, setQuickOpen]     = useState(false)

  const detailHref = {
    pathname: '/driver/reports/new' as const,
    params: {
      ...(bookingId  ? { bookingId }        : {}),
      ...(contextRef ? { ref: contextRef }  : {}),
      ...(contextDate ? { date: contextDate } : {}),
    },
  }

  return (
    <>
      <TouchableOpacity
        onPress={() => setOptionsOpen(true)}
        activeOpacity={0.85}
        accessibilityRole="button"
        accessibilityLabel="Emergency — report a case"
        style={{
          position: 'absolute', right, zIndex: 30,
          ...(top != null ? { top } : { bottom }),
          width: size, height: size, borderRadius: 999,
          alignItems: 'center', justifyContent: 'center',
          backgroundColor: D.redDim,
          // The 2px ring is what the map's own round controls wear, so the disc
          // sits in that column without looking like a different family.
          borderWidth: 2, borderColor: D.red,
          shadowColor: '#000', shadowOpacity: 0.5, shadowRadius: 10,
          shadowOffset: { width: 0, height: 4 }, elevation: 8,
        }}
      >
        <Text
          style={{
            color:         D.white,
            // Three bold caps have to clear the ring on the smaller disc too.
            fontSize:      size >= 52 ? 15 : 14,
            letterSpacing: 0.5,
            fontFamily:    FONTS.spartan.bold,
          }}
        >
          SOS
        </Text>
      </TouchableOpacity>

      <ReportOptionModal
        visible={optionsOpen}
        contextRef={contextRef}
        contextDate={contextDate}
        onQuickAlert={() => { setOptionsOpen(false); setQuickOpen(true) }}
        onDetailed={() => { setOptionsOpen(false); router.push(detailHref) }}
        onClose={() => setOptionsOpen(false)}
      />

      <QuickAlertModal
        visible={quickOpen}
        bookingId={bookingId}
        contextRef={contextRef}
        contextDate={contextDate}
        // Left on the map deliberately. The alert is away and somebody is
        // already moving; taking the driver off navigation to look at a form,
        // mid-incident, would be the wrong thing to do with the next ten
        // seconds. The report is in their list when they are ready for it.
        onSent={() => setQuickOpen(false)}
        onCancel={() => setQuickOpen(false)}
        onDetailed={() => { setQuickOpen(false); router.push(detailHref) }}
      />
    </>
  )
}
