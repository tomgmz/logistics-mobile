import React, { useEffect, useState, useMemo } from 'react'
import {
  ScrollView,
  View, Text, Modal, TextInput, TouchableOpacity,
  FlatList, ActivityIndicator, StyleSheet, KeyboardAvoidingView, Platform,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { X, Search, Users, MessageCirclePlus, CircleCheck, Circle } from 'lucide-react-native'
import { messagingApi } from '../../lib/api/messaging.api'
import type { MessagableUser } from '../../types/messaging.types'
import { roleLabel, matchesPersonSearch } from '../../lib/roles'
import { FONTS } from '../../lib/config/fonts'
import { useKeyboardHeight } from '../../hooks/useKeyboardHeight'

const C = {
  bg:       '#0a0a0a',
  sheet:    '#0e1010',
  teal:     '#033330',
  ring:     '#5a5a5a',
  card:     '#141414',
  raised:   '#1a1a1a',
  border:   '#2a2a2a',
  cyan:     '#4df9ed',
  cyanDim:  'rgba(77,249,237,0.12)',
  white:    '#ffffff',
  muted:    '#818181',
  danger:   '#f62626',
}

type Mode = 'dm' | 'group'

interface ComposeModalProps {
  visible:             boolean
  onClose:             () => void
  onConversationReady: (conversationId: string | null, user: MessagableUser) => void
  onGroupCreated:      (groupId: string, name: string) => void
}

function initials(first: string | null, last: string | null): string {
  return `${first?.[0] ?? '?'}${last?.[0] ?? ''}`.toUpperCase()
}

export default function ComposeModal({
  visible, onClose, onConversationReady, onGroupCreated,
}: ComposeModalProps) {
  const insets = useSafeAreaInsets()

  const [mode,      setMode]      = useState<Mode>('dm')
  const [users,     setUsers]     = useState<MessagableUser[]>([])
  const [loading,   setLoading]   = useState(true)
  const [error,     setError]     = useState<string | null>(null)
  const [search,    setSearch]    = useState('')
  const [busy,      setBusy]      = useState<string | null>(null) // user_id being started, or 'group'
  const [selected,  setSelected]  = useState<Set<string>>(new Set())
  const [groupName, setGroupName] = useState('')

  useEffect(() => {
    if (!visible) {
      setMode('dm'); setSearch(''); setSelected(new Set()); setGroupName(''); setBusy(null); setError(null)
      return
    }
    setLoading(true)
    messagingApi.getMessagableUsers()
      .then(setUsers)
      .catch(() => setError('Could not load contacts'))
      .finally(() => setLoading(false))
  }, [visible])

  // By name or role: "company administrator", "operations manager", "gm".
  // Clients talk one-to-one only; the API refuses them in groups.
  const filtered = useMemo(
    () => users.filter(u => (mode === 'dm' || u.role !== 'client') && matchesPersonSearch(search, u)),
    [users, search, mode],
  )

  const selectedUsers = useMemo(
    () => users.filter(u => selected.has(u.user_id)),
    [users, selected]
  )

  const toggle = (id: string) =>
    setSelected(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })

  const startDm = async (u: MessagableUser) => {
    if (busy) return
    setBusy(u.user_id)
    try {
      const conv = await messagingApi.resolveConversation(u.user_id)
      onConversationReady(conv.conversation_id, u)
    } catch {
      setError('Could not start conversation')
      setBusy(null)
    }
  }

  const createGroup = async () => {
    if (!groupName.trim() || selected.size === 0 || busy) return
    setBusy('group')
    try {
      const result = await messagingApi.createGroup({ name: groupName.trim(), member_ids: [...selected] })
      onGroupCreated(result.group_id, groupName.trim())
    } catch {
      setError('Failed to create group')
      setBusy(null)
    }
  }

  // iOS: the KeyboardAvoidingView below handles it. Android: a Modal never sees
  // the screen resize, so the sheet is lifted by the keyboard's height.
  const androidKeyboardH = useKeyboardHeight({ androidOnly: true })

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={[styles.backdrop, { paddingBottom: androidKeyboardH }]}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={[styles.sheet, { paddingBottom: insets.bottom + 8 }]}
        >
          {/* Header */}
          <View style={styles.header}>
            <View style={styles.headerLeft}>
              <MessageCirclePlus size={18} color={C.cyan} />
              <Text style={styles.headerTitle}>New Message</Text>
            </View>
            <TouchableOpacity onPress={onClose} hitSlop={10} style={styles.closeBtn}>
              <X size={18} color={C.muted} />
            </TouchableOpacity>
          </View>

          {/* DIRECT / GROUP */}
          <View style={styles.toggle}>
            {(['dm', 'group'] as const).map(m => (
              <TouchableOpacity
                key={m}
                onPress={() => setMode(m)}
                activeOpacity={0.8}
                style={[styles.toggleBtn, mode === m && styles.toggleBtnActive]}
              >
                <Text style={styles.toggleText}>{m === 'dm' ? 'DIRECT' : 'GROUP'}</Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Search */}
          <View style={styles.searchWrap}>
            <Search size={18} color={C.muted} style={{ marginRight: 10 }} />
            <TextInput
              value={search}
              onChangeText={setSearch}
              placeholder="Search by name, role..."
              placeholderTextColor="rgba(255,255,255,0.4)"
              style={styles.searchInput}
            />
          </View>

          {/* Group name */}
          {mode === 'group' && (
            <TextInput
              value={groupName}
              onChangeText={setGroupName}
              placeholder="Group Name"
              placeholderTextColor="rgba(255,255,255,0.4)"
              maxLength={100}
              style={styles.groupNameInput}
            />
          )}

          {/* List */}
          {loading ? (
            <View style={styles.center}><ActivityIndicator size="small" color={C.cyan} /></View>
          ) : error && users.length === 0 ? (
            <View style={styles.center}><Text style={styles.muted}>{error}</Text></View>
          ) : (
            <FlatList
              data={filtered}
              keyExtractor={u => u.user_id}
              keyboardShouldPersistTaps="handled"
              style={styles.list}
              ListEmptyComponent={
                <View style={styles.center}>
                  <Text style={styles.muted}>{search ? 'No contacts match' : 'No contacts available'}</Text>
                </View>
              }
              renderItem={({ item: u }) => {
                const isSel      = selected.has(u.user_id)
                const isStarting = busy === u.user_id
                return (
                  <TouchableOpacity
                    activeOpacity={0.7}
                    disabled={!!busy}
                    onPress={() => (mode === 'dm' ? startDm(u) : toggle(u.user_id))}
                    style={styles.userRow}
                  >
                    <View style={styles.avatar}>
                      <Text style={styles.avatarText}>{initials(u.first_name, u.last_name)}</Text>
                    </View>
                    <View style={styles.userBody}>
                      <Text style={styles.userName} numberOfLines={1}>{u.first_name} {u.last_name}</Text>
                      <Text style={styles.userRole} numberOfLines={1}>{roleLabel(u.role)}</Text>
                    </View>
                    {mode === 'dm'
                      ? (isStarting && <ActivityIndicator size="small" color={C.cyan} />)
                      : isSel
                        ? <CircleCheck size={22} color={C.cyan} strokeWidth={1.8} />
                        : <Circle size={22} color={C.muted} strokeWidth={1.6} />}
                  </TouchableOpacity>
                )
              }}
            />
          )}

          {/* Group: Members strip + Create Group */}
          {mode === 'group' && (
            <View style={styles.footer}>
              <Text style={styles.membersLabel}>Members</Text>
              {selectedUsers.length === 0 ? (
                <Text style={styles.membersEmpty}>Tick the people to add.</Text>
              ) : (
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  keyboardShouldPersistTaps="handled"
                  contentContainerStyle={styles.memberStrip}
                >
                  {selectedUsers.map(u => (
                    <View key={u.user_id} style={styles.member}>
                      <View style={styles.memberAvatar}>
                        <Text style={styles.avatarText}>{initials(u.first_name, u.last_name)}</Text>
                        <TouchableOpacity
                          onPress={() => toggle(u.user_id)}
                          hitSlop={8}
                          style={styles.memberRemove}
                          accessibilityLabel={`Remove ${u.first_name ?? ''} ${u.last_name ?? ''}`.trim()}
                        >
                          <X size={9} color={C.white} strokeWidth={3} />
                        </TouchableOpacity>
                      </View>
                      <Text style={styles.memberName} numberOfLines={1}>{u.first_name ?? ''}</Text>
                    </View>
                  ))}
                </ScrollView>
              )}

              {error && users.length > 0 && <Text style={styles.errorText}>{error}</Text>}
              <TouchableOpacity
                onPress={createGroup}
                disabled={!groupName.trim() || selected.size === 0 || !!busy}
                activeOpacity={0.85}
                style={[
                  styles.createBtn,
                  (!groupName.trim() || selected.size === 0 || !!busy) && styles.createBtnDisabled,
                ]}
              >
                {busy === 'group'
                  ? <ActivityIndicator size="small" color={C.cyan} />
                  : <Users size={20} color={C.cyan} />}
                <Text style={styles.createBtnText}>
                  {busy === 'group' ? 'Creating…' : 'Create Group'}
                </Text>
              </TouchableOpacity>
            </View>
          )}
        </KeyboardAvoidingView>
      </View>
    </Modal>
  )
}

// Darker Grotesque: the face in the Messages design (Figma, 2026-11-10).
const DG = FONTS.darker

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  sheet:    { maxHeight: '90%', backgroundColor: C.sheet, borderTopLeftRadius: 18, borderTopRightRadius: 18, borderWidth: 1, borderColor: '#3a3a3a' },

  header:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 10, paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: '#3a3a3a' },
  headerLeft:  { flexDirection: 'row', alignItems: 'center', gap: 6 },
  headerTitle: { color: C.white, fontFamily: DG.bold, fontSize: 18 },
  closeBtn:    { padding: 2 },

  toggle:          { flexDirection: 'row', gap: 6, marginHorizontal: 18, marginTop: 9, marginBottom: 15 },
  toggleBtn:       { flex: 1, height: 29, borderRadius: 4, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'transparent' },
  toggleBtnActive: { backgroundColor: C.teal, borderColor: C.cyan },
  toggleText:      { color: C.white, fontFamily: DG.bold, fontSize: 14, letterSpacing: 0.4 },

  searchWrap:  { flexDirection: 'row', alignItems: 'center', marginHorizontal: 16, marginBottom: 13, borderRadius: 10, borderWidth: 1, borderColor: '#2f2f2f', paddingHorizontal: 12, height: 29 },
  searchInput: { flex: 1, color: C.white, fontFamily: DG.medium, fontSize: 15, paddingVertical: 0 },

  groupNameInput: { marginHorizontal: 16, marginBottom: 6, borderWidth: 1, borderColor: C.cyan, borderRadius: 10, paddingHorizontal: 8, height: 29, paddingVertical: 0, color: C.white, fontFamily: DG.medium, fontSize: 15 },

  list:   { paddingHorizontal: 0 },
  center: { paddingVertical: 48, alignItems: 'center', justifyContent: 'center' },
  muted:  { color: C.muted, fontFamily: DG.medium, fontSize: 15 },

  userRow:   { flexDirection: 'row', alignItems: 'center', gap: 9, paddingLeft: 19, paddingRight: 16, paddingVertical: 4.5 },
  avatar:    { width: 35, height: 35, borderRadius: 17.5, borderWidth: 1, borderColor: C.ring, alignItems: 'center', justifyContent: 'center' },
  avatarText:{ color: C.white, fontFamily: DG.medium, fontSize: 15 },
  userBody:  { flex: 1 },
  userName:  { color: C.white, fontFamily: DG.medium, fontSize: 18, lineHeight: 21 },
  userRole:  { color: C.muted, fontFamily: DG.medium, fontSize: 13, lineHeight: 15 },

  footer:       { paddingHorizontal: 16, paddingTop: 6, borderTopWidth: 1, borderTopColor: '#3a3a3a' },
  membersLabel: { color: C.white, fontFamily: DG.medium, fontSize: 15, marginLeft: 3, marginBottom: 4 },
  membersEmpty: { color: C.muted, fontFamily: DG.medium, fontSize: 13, marginLeft: 3, marginBottom: 8 },
  memberStrip:  { gap: 22, paddingLeft: 11, paddingRight: 8, paddingTop: 4, paddingBottom: 6 },
  member:       { alignItems: 'center', width: 40 },
  memberAvatar: { width: 35, height: 35, borderRadius: 17.5, borderWidth: 1.5, borderColor: C.cyan, alignItems: 'center', justifyContent: 'center', backgroundColor: C.sheet },
  memberRemove: { position: 'absolute', top: -4, right: -5, width: 14, height: 14, borderRadius: 7, backgroundColor: '#5a5a5a', borderWidth: 1, borderColor: C.sheet, alignItems: 'center', justifyContent: 'center' },
  memberName:   { color: C.white, fontFamily: DG.medium, fontSize: 12, marginTop: 2, maxWidth: 52 },

  errorText:         { color: C.danger, fontFamily: DG.medium, fontSize: 14, marginBottom: 6 },
  createBtn:         { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, height: 40, borderRadius: 10, backgroundColor: '#1d3d3a', borderWidth: 1, borderColor: C.cyan, marginTop: 4 },
  createBtnDisabled: { opacity: 0.45 },
  createBtnText:     { color: C.cyan, fontFamily: DG.bold, fontSize: 18 },
})
