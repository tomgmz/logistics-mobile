import React, { useEffect, useMemo, useState } from 'react'
import {
  View, Text, TouchableOpacity, TextInput, Modal, FlatList, ScrollView,
  StyleSheet, ActivityIndicator, Alert, KeyboardAvoidingView, Platform,
} from 'react-native'
import { Users, UserPlus, Pencil, Inbox, UserMinus, Check, X, Search } from 'lucide-react-native'
import { messagingApi } from '../../lib/api/messaging.api'
import { roleLabel, matchesPersonSearch } from '../../lib/roles'
import { FONTS } from '../../lib/config/fonts'
import type { GroupMemberRequest, MessagableUser } from '../../types/messaging.types'

const C = {
  bg:       '#0a0a0a',
  sheet:    '#181818',
  raised:   '#1a1a1a',
  border:   '#2a2a2a',
  cyan:     '#4df9ed',
  cyanText: '#0a0a0a',
  white:    '#ffffff',
  muted:    '#818181',
  amber:    '#ff7a30',
  red:      '#f62626',
  overlay:  'rgba(0,0,0,0.6)',
}

export type GroupSheetView = 'menu' | 'members' | 'add' | 'rename' | 'requests'

export interface SheetMember {
  user_id:    string
  first_name: string
  last_name:  string
  role:       string
  status:     'pending' | 'accepted' | 'declined'
}

const REQUEST_SENT = 'Request sent. The group creator will approve or decline it.'

function errorText(err: unknown, fallback: string): string {
  const e = err as { response?: { data?: { message?: string } } }
  return e?.response?.data?.message ?? fallback
}

function Sheet({ title, icon, onClose, children }: {
  title: string; icon: React.ReactNode; onClose: () => void; children: React.ReactNode
}) {
  return (
    <Modal transparent visible animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <TouchableOpacity style={s.backdrop} activeOpacity={1} onPress={onClose} />
        <View style={s.sheet}>
          <View style={s.head}>
            <View style={s.headLeft}>{icon}<Text style={s.title}>{title}</Text></View>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <X size={18} color={C.muted} />
            </TouchableOpacity>
          </View>
          {children}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  )
}

function Avatar({ first, last }: { first: string; last: string }) {
  return (
    <View style={s.avatar}>
      <Text style={s.avatarText}>{`${first?.[0] ?? '?'}${last?.[0] ?? '?'}`.toUpperCase()}</Text>
    </View>
  )
}

/** The three-dots menu. Only the creator renames, adds directly and decides requests. */
function MenuSheet({ isCreator, canAct, requestCount, onPick, onClose }: {
  isCreator: boolean; canAct: boolean; requestCount: number
  onPick: (v: GroupSheetView) => void; onClose: () => void
}) {
  const Item = ({ icon, label, view, badge }: { icon: React.ReactNode; label: string; view: GroupSheetView; badge?: number }) => (
    <TouchableOpacity style={s.menuItem} activeOpacity={0.7} onPress={() => onPick(view)}>
      {icon}
      <Text style={s.menuText}>{label}</Text>
      {!!badge && <View style={s.badge}><Text style={s.badgeText}>{badge}</Text></View>}
    </TouchableOpacity>
  )
  return (
    <Sheet title="Group Options" icon={<Users size={16} color={C.cyan} />} onClose={onClose}>
      <Item icon={<Users size={17} color={C.muted} />} label="See All Members" view="members" />
      {canAct && (
        <Item icon={<UserPlus size={17} color={C.muted} />} label={isCreator ? 'Add People' : 'Ask to Add People'} view="add" />
      )}
      {canAct && isCreator && (
        <>
          <Item icon={<Pencil size={17} color={C.muted} />} label="Edit Group Name" view="rename" />
          <Item icon={<Inbox size={17} color={C.muted} />} label="Member Requests" view="requests" badge={requestCount} />
        </>
      )}
    </Sheet>
  )
}

/** Everyone in the group. The creator removes people; anyone else asks the creator to. */
function MembersSheet({ groupId, members, createdBy, currentUserId, canAct, onClose, onChanged }: {
  groupId: string; members: SheetMember[]; createdBy: string; currentUserId: string; canAct: boolean
  onClose: () => void; onChanged: () => void
}) {
  const [busyId, setBusyId] = useState<string | null>(null)
  const isCreator = createdBy === currentUserId
  const byName = (a: SheetMember, b: SheetMember) =>
    `${a.first_name} ${a.last_name}`.localeCompare(`${b.first_name} ${b.last_name}`)
  const joined  = members.filter(m => m.status === 'accepted').sort(byName)
  const invited = members.filter(m => m.status === 'pending').sort(byName)

  const remove = (m: SheetMember) => {
    const who = `${m.first_name} ${m.last_name}`.trim()
    Alert.alert(
      isCreator ? `Remove ${who}?` : `Ask to remove ${who}?`,
      isCreator ? 'They will leave the group and lose access to it.' : 'The group creator will approve or decline it.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: isCreator ? 'Remove' : 'Send request', style: 'destructive',
          onPress: async () => {
            setBusyId(m.user_id)
            try {
              const r = await messagingApi.removeGroupMember(groupId, m.user_id)
              if (r?.requested) Alert.alert('Request sent', REQUEST_SENT)
              onChanged()
            } catch (err) {
              Alert.alert('Could not remove', errorText(err, 'Please try again.'))
            } finally { setBusyId(null) }
          },
        },
      ],
    )
  }

  const row = (m: SheetMember, right?: React.ReactNode) => {
    const canRemove = canAct && m.user_id !== currentUserId && m.user_id !== createdBy
    return (
      <View key={m.user_id} style={s.personRow}>
        <Avatar first={m.first_name} last={m.last_name} />
        <View style={{ flex: 1 }}>
          <Text style={s.personName} numberOfLines={1}>{m.first_name} {m.last_name}</Text>
          <Text style={s.personRole} numberOfLines={1}>{roleLabel(m.role)}</Text>
        </View>
        {right}
        {canRemove && (busyId === m.user_id
          ? <ActivityIndicator size="small" color={C.muted} />
          : (
            <TouchableOpacity onPress={() => remove(m)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityLabel={isCreator ? 'Remove from group' : 'Ask to remove'}>
              <UserMinus size={17} color="rgba(255,255,255,0.4)" />
            </TouchableOpacity>
          ))}
      </View>
    )
  }

  return (
    <Sheet title="Members" icon={<Users size={16} color={C.cyan} />} onClose={onClose}>
      <ScrollView style={s.list}>
        <Text style={s.section}>In the group · {joined.length}</Text>
        {joined.map(m => row(m,
          <Text style={s.tag}>{m.user_id === currentUserId ? 'You' : m.user_id === createdBy ? 'Created the group' : ''}</Text>))}
        {invited.length > 0 && <Text style={[s.section, { marginTop: 14 }]}>Invited · {invited.length}</Text>}
        {invited.map(m => row(m, <Text style={[s.tag, { color: C.amber }]}>Invite pending</Text>))}
      </ScrollView>
    </Sheet>
  )
}

/** Invite people. The creator adds them; anyone else sends a request. */
function AddSheet({ groupId, members, isCreator, onClose, onDone }: {
  groupId: string; members: SheetMember[]; isCreator: boolean; onClose: () => void; onDone: () => void
}) {
  const [users,    setUsers]    = useState<MessagableUser[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [search,   setSearch]   = useState('')
  const [loading,  setLoading]  = useState(true)
  const [saving,   setSaving]   = useState(false)

  useEffect(() => {
    const inGroup = new Set(members.filter(m => m.status !== 'declined').map(m => m.user_id))
    messagingApi.getMessagableUsers()
      // Clients talk one-to-one only; the API refuses them in groups.
      .then(us => setUsers(us.filter(u => u.role !== 'client' && !inGroup.has(u.user_id))))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [members])

  const filtered = useMemo(() => users.filter(u => matchesPersonSearch(search, u)), [users, search])

  const toggle = (id: string) => setSelected(prev => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  })

  const save = async () => {
    if (!selected.size || saving) return
    setSaving(true)
    try {
      const r = await messagingApi.addGroupMembers(groupId, [...selected])
      if (r?.requested) Alert.alert('Request sent', REQUEST_SENT)
      onDone()
    } catch (err) {
      Alert.alert('Could not add people', errorText(err, 'Please try again.'))
      setSaving(false)
    }
  }

  return (
    <Sheet title={isCreator ? 'Add People' : 'Ask to Add People'} icon={<UserPlus size={16} color={C.cyan} />} onClose={onClose}>
      {!isCreator && <Text style={s.note}>The group creator approves who joins. They will see your request in the chat.</Text>}
      <View style={s.searchWrap}>
        <Search size={14} color={C.muted} />
        <TextInput value={search} onChangeText={setSearch} placeholder="Search by name or role…"
          placeholderTextColor="rgba(255,255,255,0.25)" style={s.searchInput} />
      </View>
      {loading ? (
        <ActivityIndicator style={{ marginVertical: 30 }} color={C.cyan} />
      ) : (
        <FlatList
          style={s.list}
          data={filtered}
          keyExtractor={u => u.user_id}
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={<Text style={s.empty}>{search ? 'No contacts match your search' : 'Everyone you can add is already in this group'}</Text>}
          renderItem={({ item: u }) => {
            const on = selected.has(u.user_id)
            return (
              <TouchableOpacity style={s.personRow} activeOpacity={0.7} onPress={() => toggle(u.user_id)}>
                <Avatar first={u.first_name ?? ''} last={u.last_name ?? ''} />
                <View style={{ flex: 1 }}>
                  <Text style={s.personName} numberOfLines={1}>{u.first_name} {u.last_name}</Text>
                  <Text style={s.personRole} numberOfLines={1}>{roleLabel(u.role)}</Text>
                </View>
                <View style={[s.check, on && s.checkOn]}>{on && <Check size={12} color={C.cyanText} />}</View>
              </TouchableOpacity>
            )
          }}
        />
      )}
      <TouchableOpacity style={[s.primary, (!selected.size || saving) && s.primaryOff]} disabled={!selected.size || saving} onPress={save}>
        {saving ? <ActivityIndicator size="small" color={C.cyanText} /> : (
          <Text style={s.primaryText}>
            {isCreator ? 'Add to group' : 'Send request'}{selected.size ? ` (${selected.size})` : ''}
          </Text>
        )}
      </TouchableOpacity>
    </Sheet>
  )
}

function RenameSheet({ groupId, currentName, onClose, onDone }: {
  groupId: string; currentName: string; onClose: () => void; onDone: () => void
}) {
  const [name,   setName]   = useState(currentName)
  const [saving, setSaving] = useState(false)
  const unchanged = name.trim() === currentName.trim()

  const save = async () => {
    if (!name.trim() || unchanged || saving) return
    setSaving(true)
    try {
      await messagingApi.renameGroup(groupId, name.trim())
      onDone()
    } catch (err) {
      Alert.alert('Could not rename the group', errorText(err, 'Please try again.'))
      setSaving(false)
    }
  }

  return (
    <Sheet title="Edit Group Name" icon={<Pencil size={16} color={C.cyan} />} onClose={onClose}>
      <TextInput value={name} onChangeText={setName} autoFocus maxLength={100} onSubmitEditing={save}
        placeholder="Group name…" placeholderTextColor="rgba(255,255,255,0.25)" style={s.textField} />
      <TouchableOpacity style={[s.primary, (!name.trim() || unchanged || saving) && s.primaryOff]}
        disabled={!name.trim() || unchanged || saving} onPress={save}>
        {saving ? <ActivityIndicator size="small" color={C.cyanText} /> : <Text style={s.primaryText}>Save name</Text>}
      </TouchableOpacity>
    </Sheet>
  )
}

/** The creator approves or declines each add/remove request. */
function RequestsSheet({ groupId, requests, onClose, onChanged }: {
  groupId: string; requests: GroupMemberRequest[]; onClose: () => void; onChanged: () => void
}) {
  const [busyId, setBusyId] = useState<string | null>(null)
  const decide = async (r: GroupMemberRequest, approve: boolean) => {
    setBusyId(r.request_id)
    try {
      await messagingApi.decideGroupMemberRequest(groupId, r.request_id, approve)
      onChanged()
    } catch (err) {
      Alert.alert('Could not save your decision', errorText(err, 'Please try again.'))
    } finally { setBusyId(null) }
  }
  return (
    <Sheet title="Member Requests" icon={<Inbox size={16} color={C.cyan} />} onClose={onClose}>
      <ScrollView style={s.list}>
        {requests.length === 0 && <Text style={s.empty}>No requests waiting.</Text>}
        {requests.map(r => (
          <View key={r.request_id} style={s.requestRow}>
            <Text style={s.requestText}>
              <Text style={{ color: C.white }}>{r.requested_by.name}</Text>
              {r.action === 'add' ? ' wants to add ' : ' wants to remove '}
              <Text style={{ color: C.white }}>{r.target.name}</Text>
              {r.action === 'add' ? ' to the group.' : ' from the group.'}
            </Text>
            <View style={s.requestBtns}>
              <TouchableOpacity style={[s.reqBtn, s.reqApprove]} disabled={busyId === r.request_id} onPress={() => decide(r, true)}>
                {busyId === r.request_id ? <ActivityIndicator size="small" color={C.cyanText} />
                  : <><Check size={14} color={C.cyanText} /><Text style={s.reqApproveText}>Approve</Text></>}
              </TouchableOpacity>
              <TouchableOpacity style={[s.reqBtn, s.reqDecline]} disabled={busyId === r.request_id} onPress={() => decide(r, false)}>
                <X size={14} color={C.muted} /><Text style={s.reqDeclineText}>Decline</Text>
              </TouchableOpacity>
            </View>
          </View>
        ))}
      </ScrollView>
    </Sheet>
  )
}

export default function GroupSheets({
  view, groupId, groupName, createdBy, currentUserId, canAct, members, requests, onView, onClose, onChanged,
}: {
  view:          GroupSheetView | null
  groupId:       string
  groupName:     string
  createdBy:     string
  currentUserId: string
  /** False until the user has accepted the invite. */
  canAct:        boolean
  members:       SheetMember[]
  requests:      GroupMemberRequest[]
  onView:        (v: GroupSheetView) => void
  onClose:       () => void
  /** After a rename, add, removal or decision: reload the group. */
  onChanged:     () => void
}) {
  const isCreator = createdBy === currentUserId
  const done = () => { onChanged(); onClose() }
  if (view === 'menu') return <MenuSheet isCreator={isCreator} canAct={canAct} requestCount={requests.length} onPick={onView} onClose={onClose} />
  if (view === 'members') return (
    <MembersSheet groupId={groupId} members={members} createdBy={createdBy} currentUserId={currentUserId}
      canAct={canAct} onClose={onClose} onChanged={onChanged} />
  )
  if (view === 'add' && canAct) return <AddSheet groupId={groupId} members={members} isCreator={isCreator} onClose={onClose} onDone={done} />
  if (view === 'rename' && canAct && isCreator) return <RenameSheet groupId={groupId} currentName={groupName} onClose={onClose} onDone={done} />
  if (view === 'requests' && isCreator) return <RequestsSheet groupId={groupId} requests={requests} onClose={onClose} onChanged={onChanged} />
  return null
}

const s = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: C.overlay },
  sheet:    { backgroundColor: C.sheet, borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingHorizontal: 18, paddingTop: 14, paddingBottom: 30, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.07)', maxHeight: '80%' },
  head:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  headLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title:    { color: C.white, fontFamily: FONTS.alegreyaSans.medium, fontSize: 15 },

  menuItem: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.05)' },
  menuText: { flex: 1, color: C.white, fontFamily: FONTS.alegreyaSans.regular, fontSize: 15 },
  badge:    { minWidth: 20, height: 20, borderRadius: 10, paddingHorizontal: 5, backgroundColor: C.cyan, alignItems: 'center', justifyContent: 'center' },
  badgeText:{ color: C.cyanText, fontFamily: FONTS.alegreyaSans.bold, fontSize: 11 },

  list:       { maxHeight: 420 },
  section:    { color: C.muted, fontFamily: FONTS.alegreyaSans.medium, fontSize: 11, letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: 6 },
  personRow:  { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 9 },
  avatar:     { width: 36, height: 36, borderRadius: 18, backgroundColor: C.raised, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: 'rgba(255,255,255,0.75)', fontFamily: FONTS.alegreyaSans.bold, fontSize: 12 },
  personName: { color: C.white, fontFamily: FONTS.alegreyaSans.regular, fontSize: 14 },
  personRole: { color: C.muted, fontFamily: FONTS.alegreyaSans.regular, fontSize: 11, marginTop: 1 },
  tag:        { color: C.muted, fontFamily: FONTS.alegreyaSans.regular, fontSize: 11, marginRight: 6 },
  empty:      { color: C.muted, fontFamily: FONTS.alegreyaSans.regular, fontSize: 13, textAlign: 'center', paddingVertical: 28 },
  note:       { color: C.muted, fontFamily: FONTS.alegreyaSans.regular, fontSize: 12, marginBottom: 10 },

  searchWrap:  { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: C.raised, borderRadius: 12, borderWidth: 1, borderColor: C.border, paddingHorizontal: 12, marginBottom: 8 },
  searchInput: { flex: 1, color: C.white, fontFamily: FONTS.alegreyaSans.regular, fontSize: 14, paddingVertical: 9 },
  check:       { width: 22, height: 22, borderRadius: 11, borderWidth: 1, borderColor: 'rgba(255,255,255,0.25)', alignItems: 'center', justifyContent: 'center' },
  checkOn:     { backgroundColor: C.cyan, borderColor: C.cyan },
  textField:   { backgroundColor: C.raised, borderRadius: 12, borderWidth: 1, borderColor: C.border, paddingHorizontal: 14, paddingVertical: 11, color: C.white, fontFamily: FONTS.alegreyaSans.regular, fontSize: 15 },

  primary:     { marginTop: 14, height: 46, borderRadius: 14, backgroundColor: C.cyan, alignItems: 'center', justifyContent: 'center' },
  primaryOff:  { opacity: 0.35 },
  primaryText: { color: C.cyanText, fontFamily: FONTS.alegreyaSans.bold, fontSize: 15 },

  requestRow:     { paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.05)', gap: 10 },
  requestText:    { color: 'rgba(255,255,255,0.8)', fontFamily: FONTS.alegreyaSans.regular, fontSize: 14, lineHeight: 20 },
  requestBtns:    { flexDirection: 'row', gap: 8 },
  reqBtn:         { flex: 1, height: 38, borderRadius: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  reqApprove:     { backgroundColor: C.cyan },
  reqApproveText: { color: C.cyanText, fontFamily: FONTS.alegreyaSans.bold, fontSize: 13 },
  reqDecline:     { borderWidth: 1, borderColor: C.border },
  reqDeclineText: { color: C.muted, fontFamily: FONTS.alegreyaSans.medium, fontSize: 13 },
})
