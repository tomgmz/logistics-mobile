import React, { useEffect, useState, useMemo } from 'react'
import {
  View, Text, Modal, TextInput, TouchableOpacity,
  FlatList, ActivityIndicator, StyleSheet, KeyboardAvoidingView, Platform,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { X, Search, Users, MessageCirclePlus, Check } from 'lucide-react-native'
import { messagingApi } from '../../lib/api/messaging.api'
import type { MessagableUser } from '../../types/messaging.types'

const C = {
  bg:       '#0a0a0a',
  card:     '#141414',
  raised:   '#1a1a1a',
  border:   '#2a2a2a',
  cyan:     '#4df9ed',
  cyanDim:  'rgba(77,249,237,0.12)',
  white:    '#ffffff',
  muted:    '#818181',
  danger:   '#f87171',
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

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    return users.filter(u =>
      `${u.first_name ?? ''} ${u.last_name ?? ''}`.toLowerCase().includes(q) ||
      u.role.toLowerCase().includes(q)
    )
  }, [users, search])

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

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={[styles.sheet, { paddingBottom: insets.bottom + 8 }]}
        >
          {/* Header */}
          <View style={styles.header}>
            <View style={styles.headerLeft}>
              {mode === 'dm'
                ? <MessageCirclePlus size={16} color={C.cyan} />
                : <Users size={16} color={C.cyan} />}
              <Text style={styles.headerTitle}>{mode === 'dm' ? 'New Message' : 'New Group'}</Text>
            </View>
            <TouchableOpacity onPress={onClose} hitSlop={10} style={styles.closeBtn}>
              <X size={16} color={C.muted} />
            </TouchableOpacity>
          </View>

          {/* Mode toggle */}
          <View style={styles.toggle}>
            <TouchableOpacity
              onPress={() => setMode('dm')}
              style={[styles.toggleBtn, mode === 'dm' && styles.toggleBtnActive]}
            >
              <Text style={[styles.toggleText, mode === 'dm' && styles.toggleTextActive]}>Direct</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => setMode('group')}
              style={[styles.toggleBtn, mode === 'group' && styles.toggleBtnActive]}
            >
              <Text style={[styles.toggleText, mode === 'group' && styles.toggleTextActive]}>Group</Text>
            </TouchableOpacity>
          </View>

          {/* Group name */}
          {mode === 'group' && (
            <TextInput
              value={groupName}
              onChangeText={setGroupName}
              placeholder="Group name…"
              placeholderTextColor="rgba(255,255,255,0.22)"
              maxLength={100}
              style={styles.groupNameInput}
            />
          )}

          {/* Selected chips */}
          {mode === 'group' && selectedUsers.length > 0 && (
            <View style={styles.chipWrap}>
              {selectedUsers.map(u => (
                <TouchableOpacity key={u.user_id} onPress={() => toggle(u.user_id)} style={styles.chip}>
                  <Text style={styles.chipText}>{u.first_name} {u.last_name}</Text>
                  <X size={11} color={C.cyan} />
                </TouchableOpacity>
              ))}
            </View>
          )}

          {/* Search */}
          <View style={styles.searchWrap}>
            <Search size={14} color={C.muted} style={{ marginRight: 8 }} />
            <TextInput
              value={search}
              onChangeText={setSearch}
              placeholder="Search by name or role…"
              placeholderTextColor="rgba(255,255,255,0.22)"
              style={styles.searchInput}
            />
          </View>

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
                const isSel     = selected.has(u.user_id)
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
                      <Text style={styles.userRole} numberOfLines={1}>{u.role.replace(/_/g, ' ')}</Text>
                    </View>
                    {mode === 'dm'
                      ? (isStarting && <ActivityIndicator size="small" color={C.cyan} />)
                      : (
                        <View style={[styles.checkbox, isSel && styles.checkboxOn]}>
                          {isSel && <Check size={12} color={C.bg} />}
                        </View>
                      )}
                  </TouchableOpacity>
                )
              }}
            />
          )}

          {/* Group create footer */}
          {mode === 'group' && (
            <View style={styles.footer}>
              {error && users.length > 0 && <Text style={styles.errorText}>{error}</Text>}
              <TouchableOpacity
                onPress={createGroup}
                disabled={!groupName.trim() || selected.size === 0 || !!busy}
                style={[
                  styles.createBtn,
                  (!groupName.trim() || selected.size === 0 || !!busy) && styles.createBtnDisabled,
                ]}
              >
                {busy === 'group'
                  ? <ActivityIndicator size="small" color={C.bg} />
                  : <Users size={15} color={C.bg} />}
                <Text style={styles.createBtnText}>
                  {busy === 'group' ? 'Creating…' : `Create group${selected.size > 0 ? ` (${selected.size})` : ''}`}
                </Text>
              </TouchableOpacity>
            </View>
          )}
        </KeyboardAvoidingView>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  backdrop:   { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  sheet:      { maxHeight: '88%', backgroundColor: C.bg, borderTopLeftRadius: 20, borderTopRightRadius: 20, borderWidth: 1, borderColor: C.border },

  header:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 16, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: C.border },
  headerLeft:  { flexDirection: 'row', alignItems: 'center', gap: 8 },
  headerTitle: { color: C.white, fontSize: 13, fontWeight: '700', letterSpacing: 1.5, textTransform: 'uppercase' },
  closeBtn:    { padding: 4 },

  toggle:          { flexDirection: 'row', gap: 6, margin: 12, padding: 4, backgroundColor: C.raised, borderRadius: 12, borderWidth: 1, borderColor: C.border },
  toggleBtn:       { flex: 1, paddingVertical: 8, borderRadius: 8, alignItems: 'center' },
  toggleBtnActive: { backgroundColor: C.cyanDim },
  toggleText:      { color: C.muted, fontSize: 13, fontWeight: '600' },
  toggleTextActive:{ color: C.cyan },

  groupNameInput: { marginHorizontal: 12, marginBottom: 8, backgroundColor: C.raised, borderWidth: 1, borderColor: C.border, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, color: C.white, fontSize: 14 },

  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingHorizontal: 12, paddingBottom: 8 },
  chip:     { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: C.cyanDim, borderWidth: 1, borderColor: 'rgba(77,249,237,0.25)', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 },
  chipText: { color: C.cyan, fontSize: 12 },

  searchWrap:  { flexDirection: 'row', alignItems: 'center', marginHorizontal: 12, marginBottom: 8, backgroundColor: C.raised, borderRadius: 12, borderWidth: 1, borderColor: C.border, paddingHorizontal: 12, height: 42 },
  searchInput: { flex: 1, color: C.white, fontSize: 14, paddingVertical: 0 },

  list:   { paddingHorizontal: 8 },
  center: { paddingVertical: 48, alignItems: 'center', justifyContent: 'center' },
  muted:  { color: C.muted, fontSize: 13 },

  userRow:  { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 8, paddingVertical: 10 },
  avatar:   { width: 40, height: 40, borderRadius: 20, backgroundColor: C.raised, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center' },
  avatarText:{ color: C.white, fontSize: 13, fontWeight: '700' },
  userBody: { flex: 1 },
  userName: { color: C.white, fontSize: 14 },
  userRole: { color: C.muted, fontSize: 11, textTransform: 'capitalize', marginTop: 1 },

  checkbox:   { width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.25)', alignItems: 'center', justifyContent: 'center' },
  checkboxOn: { backgroundColor: C.cyan, borderColor: C.cyan },

  footer:           { paddingHorizontal: 12, paddingTop: 8, borderTopWidth: 1, borderTopColor: C.border },
  errorText:        { color: C.danger, fontSize: 12, marginBottom: 8 },
  createBtn:        { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: C.cyan, borderRadius: 12, paddingVertical: 12, marginTop: 4 },
  createBtnDisabled:{ opacity: 0.3 },
  createBtnText:    { color: C.bg, fontSize: 14, fontWeight: '700' },
})
