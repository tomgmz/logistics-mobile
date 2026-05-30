import React, { useEffect } from 'react'
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  TouchableWithoutFeedback,
  StyleSheet,
  useWindowDimensions,
  Platform,
  BackHandler,
} from 'react-native'
import { MotiView, AnimatePresence } from 'moti'
import { Easing } from 'react-native-reanimated'

const COLORS = {
  bg:          '#1a1a1a',
  surface:     '#424242',
  cyan:        '#00e5ff',
  white:       '#ffffff',
  whiteMuted:  'rgba(255,255,255,0.75)',
  whiteFaint:  'rgba(255,255,255,0.10)',
  border:      '#818181',
  overlay:     'rgba(0,0,0,0.55)',
}

export interface ReusableModalProps {
  open:                 boolean
  title:                string
  description?:         string
  confirmLabel?:        string
  cancelLabel?:         string
  onConfirm?:           () => void
  onCancel?:            () => void
  disableBackdropClose?: boolean
}

export default function ReusableModal({
  open,
  title,
  description,
  confirmLabel        = 'Yes',
  cancelLabel         = 'No',
  onConfirm,
  onCancel,
  disableBackdropClose = false,
}: ReusableModalProps) {
  const { width } = useWindowDimensions()
  const isTablet   = width >= 640

  useEffect(() => {
    if (!open) return
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onCancel?.()
      return true
    })
    return () => sub.remove()
  }, [open, onCancel])

  return (
    <Modal
      visible={open}
      transparent
      animationType="none"
      statusBarTranslucent
      onRequestClose={onCancel}
    >
      <AnimatePresence>
        {open && (
          <MotiView
            key="backdrop"
            from={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ type: 'timing', duration: 200 }}
            style={[styles.backdrop, isTablet && styles.backdropCenter]}
          >
            <TouchableWithoutFeedback
              onPress={disableBackdropClose ? undefined : onCancel}
            >
              <View style={StyleSheet.absoluteFill} />
            </TouchableWithoutFeedback>

            <MotiView
              key="card"
              from={isTablet
                ? { opacity: 0, scale: 0.93, translateY: 16 }
                : { opacity: 0, translateY: 300 }}
              animate={isTablet
                ? { opacity: 1, scale: 1,    translateY: 0 }
                : { opacity: 1, translateY: 0 }}
              exit={isTablet
                ? { opacity: 0, scale: 0.95, translateY: 8 }
                : { opacity: 0, translateY: 300 }}
              transition={isTablet
                ? { type: 'spring', stiffness: 320, damping: 28 }
                : { type: 'timing', duration: 400, easing: Easing.out(Easing.cubic) }}
              style={[
                styles.card,
                isTablet ? styles.cardTablet : styles.cardMobile,
              ]}
            >
              {!isTablet && (
                <View style={styles.pillWrap} pointerEvents="none">
                  <View style={styles.pill} />
                </View>
              )}

              <View style={styles.content}>
                <Text style={styles.title}>{title}</Text>
                {description && (
                  <Text style={styles.description}>{description}</Text>
                )}
              </View>

              <View style={[styles.actions, isTablet && styles.actionsTablet]}>
                <TouchableOpacity
                  activeOpacity={0.75}
                  onPress={onCancel}
                  style={[styles.btn, styles.btnCancel, isTablet && styles.btnTablet]}
                >
                  <Text style={styles.btnText}>{cancelLabel}</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  activeOpacity={0.75}
                  onPress={onConfirm}
                  style={[styles.btn, styles.btnConfirm, isTablet && styles.btnTablet]}
                >
                  <Text style={styles.btnText}>{confirmLabel}</Text>
                </TouchableOpacity>
              </View>
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
    alignItems:      'center',
  },
  backdropCenter: {
    justifyContent: 'center',
    padding:        16,
  },

  card: {
    backgroundColor: COLORS.surface,
    width:           '100%',
  },
  cardMobile: {
    borderTopLeftRadius:  18,
    borderTopRightRadius: 18,
  },
  cardTablet: {
    borderRadius: 20,
    maxWidth:     480,
    alignSelf:    'center',
  },

  pillWrap: {
    alignItems:  'center',
    paddingTop:  10,
    paddingBottom: 4,
  },
  pill: {
    width:           32,
    height:          3,
    borderRadius:    2,
    backgroundColor: 'rgba(255,255,255,0.25)',
  },

  content: {
    paddingHorizontal: 20,
    paddingTop:        16,
    paddingBottom:     12,
  },
  title: {
    color:       COLORS.white,
    fontSize:    18,
    fontWeight:  '700',
    lineHeight:  24,
    letterSpacing: 0.3,
  },
  description: {
    color:      COLORS.whiteMuted,
    fontSize:   14,
    lineHeight: 22,
    marginTop:  8,
  },

  actions: {
    flexDirection:   'column-reverse',
    gap:             8,
    paddingHorizontal: 20,
    paddingTop:      8,
    paddingBottom:   32,
  },
  actionsTablet: {
    flexDirection:   'row',
    justifyContent:  'flex-end',
    paddingBottom:   20,
    paddingTop:      4,
  },

  btn: {
    height:         44,
    borderRadius:   8,
    alignItems:     'center',
    justifyContent: 'center',
  },
  btnTablet: {
    height: 40,
    width:  88,
  },
  btnCancel: {
    borderWidth:     1,
    borderColor:     COLORS.border,
    backgroundColor: 'transparent',
  },
  btnConfirm: {
    backgroundColor: COLORS.whiteFaint,
  },
  btnText: {
    color:      COLORS.white,
    fontSize:   15,
    fontWeight: '500',
  },
})