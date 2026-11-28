import React, { useCallback, useEffect, useState } from 'react'
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { CloudOff, RotateCw } from 'lucide-react-native'
import PdfRendererView from 'react-native-pdf-renderer'

import { useAuthStore } from '../../../lib/store/auth.store'
import { GuideUnavailable, loadUserGuide } from '../../../lib/userGuide'
import { FONTS } from '../../../lib/config/fonts'

/**
 * The driver's User Guide, inside the app (2026-11-28), opened from Profile →
 * User Guide. Pages scroll and pinch-zoom here with the phone's own PDF engine
 * (react-native-pdf-renderer: Android PdfRenderer / iOS PDFKit). The guide is
 * kept on the phone after the first open, so it also opens with no signal
 * (lib/userGuide.ts).
 */

const C = {
  bg:     '#000000',
  page:   '#0e1010',
  line:   '#424242',
  white:  '#ffffff',
  soft:   'rgba(255,255,255,0.85)',
  faint:  '#818181',
  cyan:   '#4df9ed',
  yellow: '#ffea00',
}

type State =
  | { kind: 'loading' }
  | { kind: 'ready'; uri: string; offline: boolean }
  | { kind: 'error'; message: string }

export default function UserGuideScreen() {
  const insets = useSafeAreaInsets()
  const role   = useAuthStore((s) => s.user?.role ?? 'driver')

  const [state, setState] = useState<State>({ kind: 'loading' })
  const [page,  setPage]  = useState<{ at: number; of: number } | null>(null)

  const load = useCallback(async () => {
    setState({ kind: 'loading' })
    try {
      const r = await loadUserGuide(role)
      setState({ kind: 'ready', uri: r.uri, offline: r.offline })
    } catch (err) {
      setState({
        kind:    'error',
        message: err instanceof GuideUnavailable ? err.message : 'The user guide could not be opened. Please try again.',
      })
    }
  }, [role])

  useEffect(() => { void load() }, [load])

  if (state.kind === 'loading') {
    return (
      <View style={[styles.root, styles.center]}>
        <ActivityIndicator color={C.cyan} />
        <Text style={styles.note}>Opening the user guide…</Text>
      </View>
    )
  }

  if (state.kind === 'error') {
    return (
      <View style={[styles.root, styles.center, { paddingHorizontal: 24 }]}>
        <Text style={styles.errorText}>{state.message}</Text>
        <TouchableOpacity onPress={() => void load()} activeOpacity={0.75} accessibilityRole="button" style={styles.button}>
          <RotateCw size={15} color={C.white} />
          <Text style={styles.buttonText}>Retry</Text>
        </TouchableOpacity>
      </View>
    )
  }

  return (
    <View style={styles.root}>
      {state.offline && (
        <View style={styles.offline}>
          <CloudOff size={15} color={C.yellow} />
          <Text style={styles.offlineText}>No signal. Showing the copy saved on this phone.</Text>
        </View>
      )}

      <PdfRendererView
        style={styles.pdf}
        source={state.uri}
        distanceBetweenPages={12}
        maxZoom={4}
        onPageChange={(at, of) => setPage({ at, of })}
        onError={() => setState({ kind: 'error', message: 'The user guide could not be shown. Please try again.' })}
      />

      {page && page.of > 0 && (
        <View pointerEvents="none" style={[styles.pager, { bottom: Math.max(insets.bottom, 12) + 8 }]}>
          <Text style={styles.pagerText}>Page {page.at} of {page.of}</Text>
        </View>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  root:   { flex: 1, backgroundColor: C.bg },
  center: { alignItems: 'center', justifyContent: 'center', gap: 14 },
  pdf:    { flex: 1, backgroundColor: C.page },

  note:       { color: C.faint, fontSize: 15, fontFamily: FONTS.darker.regular },
  errorText:  { color: C.soft, fontSize: 16, lineHeight: 22, textAlign: 'center', fontFamily: FONTS.darker.regular },
  button:     {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    minHeight: 44, borderRadius: 8, borderWidth: 0.5, borderColor: C.line, paddingHorizontal: 20,
  },
  buttonText: { color: C.white, fontSize: 15, fontFamily: FONTS.darker.medium },

  offline:     {
    flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 10,
    backgroundColor: 'rgba(255,234,0,0.08)', borderBottomWidth: 0.5, borderBottomColor: 'rgba(255,234,0,0.35)',
  },
  offlineText: { flex: 1, color: C.soft, fontSize: 14, fontFamily: FONTS.darker.regular },

  pager:     {
    position: 'absolute', alignSelf: 'center', borderRadius: 14, paddingHorizontal: 12, paddingVertical: 5,
    backgroundColor: 'rgba(0,0,0,0.75)', borderWidth: 0.5, borderColor: C.line,
  },
  pagerText: { color: C.white, fontSize: 13, fontFamily: FONTS.darker.medium },
})
