import React, { useState } from 'react'
import { View, Text, Image, TouchableOpacity, Modal, StyleSheet, Pressable } from 'react-native'
import { MapPin, X } from 'lucide-react-native'
import { FONTS } from '../../lib/config/fonts'
import { PHOTO_PLACEHOLDER } from '../../lib/chatPhoto'

/**
 * A photo message inside a chat bubble: the picture (tap for full screen) with
 * its caption under it. A photo sent without a caption carries the "📷 Photo"
 * placeholder as its text, which is not repeated under the picture.
 */
export default function ChatPhotoBubble({ url, stamped, caption, textStyle, onLongPress }: {
  url:          string
  stamped?:     boolean
  caption:      string
  textStyle:    object
  onLongPress?: () => void
}) {
  const [open, setOpen] = useState(false)
  const shown = caption && caption !== PHOTO_PLACEHOLDER ? caption : null

  return (
    <View style={s.wrap}>
      <TouchableOpacity activeOpacity={0.9} onPress={() => setOpen(true)} onLongPress={onLongPress} delayLongPress={350}>
        <Image source={{ uri: url }} style={s.image} resizeMode="cover" />
        {stamped && (
          <View style={s.tag}>
            <MapPin size={9} color="#fff" />
            <Text style={s.tagText}>Stamped</Text>
          </View>
        )}
      </TouchableOpacity>
      {shown && <Text style={[textStyle, s.caption]}>{shown}</Text>}

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={s.viewer} onPress={() => setOpen(false)}>
          <Image source={{ uri: url }} style={s.full} resizeMode="contain" />
          <TouchableOpacity style={s.close} onPress={() => setOpen(false)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <X size={22} color="#fff" />
          </TouchableOpacity>
        </Pressable>
      </Modal>
    </View>
  )
}

const s = StyleSheet.create({
  wrap:    { gap: 6, marginHorizontal: -8, marginTop: -4 },
  image:   { width: 220, height: 280, borderRadius: 14, backgroundColor: 'rgba(0,0,0,0.25)' },
  tag:     { position: 'absolute', top: 6, left: 6, flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 10, backgroundColor: 'rgba(0,0,0,0.55)' },
  tagText: { color: '#fff', fontFamily: FONTS.alegreyaSans.medium, fontSize: 9 },
  caption: { paddingHorizontal: 8 },
  viewer:  { flex: 1, backgroundColor: 'rgba(0,0,0,0.95)', alignItems: 'center', justifyContent: 'center' },
  full:    { width: '100%', height: '85%' },
  close:   { position: 'absolute', top: 48, right: 20 },
})
