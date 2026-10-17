import React, { useEffect, useState } from 'react'
import {
  View, Text, TouchableOpacity, Modal, Image, TextInput,
  StyleSheet, ActivityIndicator, Pressable, Keyboard, Platform,
} from 'react-native'
import { Camera, Image as ImageIcon, MapPin, X } from 'lucide-react-native'
import { FONTS } from '../../lib/config/fonts'
import {
  pickChatPhoto, uploadChatPhoto, ChatPhotoError,
  type ChatPhotoMode, type ChatPhotoSource, type PickedChatPhoto,
} from '../../lib/chatPhoto'

const C = {
  bg:       '#181818',
  raised:   '#1e1e1e',
  border:   'rgba(255,255,255,0.08)',
  white:    '#ffffff',
  muted:    '#818181',
  dim:      'rgba(255,255,255,0.45)',
  cyan:     '#4df9ed',
  cyanText: '#0a0a0a',
  cyanSoft: 'rgba(77,249,237,0.10)',
  red:      '#f62626',
  overlay:  'rgba(0,0,0,0.6)',
}

/**
 * Sending a photo in chat: take one or pick one (up to 10 MB), then choose
 * "With stamp" — the same time-and-place stamp as the proof photos — or
 * "No stamp", add an optional message, and send. Uploads, then hands the
 * stored URL to `onSend`.
 */
export default function ChatPhotoSheet({ visible, onClose, onSend }: {
  visible: boolean
  onClose: () => void
  onSend:  (attachmentUrl: string, caption: string) => void
}) {
  const [photo,   setPhoto]   = useState<PickedChatPhoto | null>(null)
  const [mode,    setMode]    = useState<ChatPhotoMode>('stamp')
  const [caption, setCaption] = useState('')
  const [busy,    setBusy]    = useState(false)
  const [error,   setError]   = useState<string | null>(null)

  // How far the keyboard covers the screen. A Modal is its own window, so on
  // Android the screen's resize-for-keyboard never reaches it and the message
  // box ended up under the keyboard; the sheet lifts itself instead.
  const [keyboardH, setKeyboardH] = useState(0)
  useEffect(() => {
    const showEvt = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow'
    const hideEvt = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide'
    const show = Keyboard.addListener(showEvt, (e) => setKeyboardH(e.endCoordinates.height))
    const hide = Keyboard.addListener(hideEvt, () => setKeyboardH(0))
    return () => { show.remove(); hide.remove() }
  }, [])

  // Every opening starts again at the source choice.
  useEffect(() => {
    if (!visible) { setPhoto(null); setMode('stamp'); setCaption(''); setBusy(false); setError(null) }
  }, [visible])

  const pick = async (source: ChatPhotoSource) => {
    setError(null)
    try {
      const picked = await pickChatPhoto(source)
      if (picked) setPhoto(picked)
    } catch (err) {
      setError(err instanceof ChatPhotoError ? err.message : 'That photo could not be opened.')
    }
  }

  const send = async () => {
    if (!photo || busy) return
    setBusy(true); setError(null)
    try {
      const { url } = await uploadChatPhoto(photo, mode)
      onSend(url, caption.trim())
    } catch (err) {
      setError(err instanceof ChatPhotoError ? err.message : 'The photo could not be sent. Try again.')
      setBusy(false)
    }
  }

  const option = (value: ChatPhotoMode, icon: React.ReactNode, title: string, hint: string) => {
    const active = mode === value
    return (
      <TouchableOpacity
        onPress={() => setMode(value)}
        disabled={busy}
        activeOpacity={0.8}
        style={[s.option, active && s.optionActive]}
      >
        {icon}
        <View style={{ flex: 1 }}>
          <Text style={s.optionTitle}>{title}</Text>
          <Text style={s.optionHint}>{hint}</Text>
        </View>
      </TouchableOpacity>
    )
  }

  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={() => { if (!busy) onClose() }}>
      <View style={[s.backdrop, { paddingBottom: keyboardH }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={() => { if (!busy) onClose() }} />
        <View style={s.sheet}>
          <View style={s.header}>
            <Text style={s.title}>Send a photo</Text>
            <TouchableOpacity onPress={onClose} disabled={busy} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <X size={18} color={C.muted} />
            </TouchableOpacity>
          </View>

          {!photo ? (
            <View style={s.sources}>
              <TouchableOpacity style={s.source} activeOpacity={0.8} onPress={() => void pick('camera')}>
                <Camera size={22} color={C.cyan} />
                <Text style={s.sourceText}>Take a photo</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.source} activeOpacity={0.8} onPress={() => void pick('library')}>
                <ImageIcon size={22} color={C.cyan} />
                <Text style={s.sourceText}>Choose from gallery</Text>
              </TouchableOpacity>
              <Text style={s.note}>Photos can be up to 10 MB.</Text>
            </View>
          ) : (
            <>
              {/* Smaller while typing, so the photo, the choice and the message box all fit above the keyboard. */}
              <Image source={{ uri: photo.uri }} style={[s.preview, keyboardH > 0 && s.previewSmall]} resizeMode="contain" />

              <View style={s.options}>
                {option('stamp', <MapPin size={18} color={mode === 'stamp' ? C.cyan : C.muted} />, 'With stamp', 'Time, date and place on the photo')}
                {option('plain', <ImageIcon size={18} color={mode === 'plain' ? C.cyan : C.muted} />, 'No stamp', 'The photo as it is')}
              </View>

              <TextInput
                value={caption}
                onChangeText={setCaption}
                placeholder="Add a message (optional)"
                placeholderTextColor="rgba(255,255,255,0.25)"
                maxLength={5000}
                editable={!busy}
                style={s.caption}
                selectionColor={C.cyan}
                multiline
              />

              <View style={s.actions}>
                <TouchableOpacity style={[s.btn, s.btnGhost]} onPress={() => setPhoto(null)} disabled={busy} activeOpacity={0.8}>
                  <Text style={s.btnGhostText}>Change photo</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[s.btn, s.btnPrimary, busy && { opacity: 0.7 }]} onPress={() => void send()} disabled={busy} activeOpacity={0.8}>
                  {busy ? <ActivityIndicator size="small" color={C.cyanText} /> : <Text style={s.btnPrimaryText}>Send</Text>}
                </TouchableOpacity>
              </View>
            </>
          )}

          {error && <Text style={s.error}>{error}</Text>}
        </View>
      </View>
    </Modal>
  )
}

const s = StyleSheet.create({
  backdrop:   { flex: 1, backgroundColor: C.overlay, justifyContent: 'flex-end' },
  sheet:      { backgroundColor: C.bg, borderTopLeftRadius: 20, borderTopRightRadius: 20, borderWidth: 1, borderColor: C.border, padding: 18, paddingBottom: 30, gap: 14 },
  header:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title:      { color: C.white, fontFamily: FONTS.alegreyaSans.bold, fontSize: 16 },

  sources:    { gap: 10 },
  source:     { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 14, borderRadius: 14, borderWidth: 1, borderColor: C.border, backgroundColor: C.raised },
  sourceText: { color: C.white, fontFamily: FONTS.alegreyaSans.medium, fontSize: 15 },
  note:       { color: C.dim, fontFamily: FONTS.alegreyaSans.regular, fontSize: 12, textAlign: 'center' },

  preview:    { width: '100%', height: 260, borderRadius: 14, backgroundColor: '#000' },
  previewSmall: { height: 120 },
  options:    { flexDirection: 'row', gap: 10 },
  option:     { flex: 1, flexDirection: 'row', alignItems: 'flex-start', gap: 8, padding: 12, borderRadius: 14, borderWidth: 1, borderColor: C.border },
  optionActive: { borderColor: C.cyan, backgroundColor: C.cyanSoft },
  optionTitle:  { color: C.white, fontFamily: FONTS.alegreyaSans.medium, fontSize: 14 },
  optionHint:   { color: C.dim, fontFamily: FONTS.alegreyaSans.regular, fontSize: 11, marginTop: 2 },

  caption:    { backgroundColor: C.raised, borderRadius: 14, borderWidth: 1, borderColor: C.border, paddingHorizontal: 14, paddingVertical: 10, color: C.white, fontFamily: FONTS.alegreyaSans.regular, fontSize: 14, minHeight: 44, maxHeight: 100, textAlignVertical: 'top' },
  actions:    { flexDirection: 'row', gap: 10 },
  btn:        { flex: 1, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  btnGhost:   { borderWidth: 1, borderColor: C.border },
  btnGhostText: { color: C.white, fontFamily: FONTS.alegreyaSans.medium, fontSize: 14 },
  btnPrimary: { backgroundColor: C.cyan },
  btnPrimaryText: { color: C.cyanText, fontFamily: FONTS.alegreyaSans.bold, fontSize: 14 },
  error:      { color: C.red, fontFamily: FONTS.alegreyaSans.regular, fontSize: 12 },
})
