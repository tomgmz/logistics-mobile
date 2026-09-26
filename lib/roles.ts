// Display names for roles. The UI always spells a role out in full — never
// "Admin", "GM" or "Ops" — so anything showing a role goes through roleLabel()
// instead of printing the raw role id.
export const ROLE_LABELS: Record<string, string> = {
  admin:              'Company Administrator',
  it_admin:           'IT Administrator',
  general_manager:    'General Manager',
  fleet_manager:      'Fleet Manager',
  operations_manager: 'Operations Manager',
  driver:             'Driver',
  client:             'Client',
}

export function roleLabel(role: string | null | undefined): string {
  if (!role) return ''
  return ROLE_LABELS[role] ?? role.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

// Notification text is stored at send time, so rows written before the UI
// dropped abbreviations still say "GM" / "Admin" / "Ops". Expand on display.
const TEXT_TOKENS: [RegExp, string][] = [
  [/(Fleet|Operations) Admin(istrator)?s/g, '$1 Managers'],
  [/(Fleet|Operations) Admin(istrator)?/g,  '$1 Manager'],
  [/selected by operations/g,              'selected by the Operations Manager'],
  [/GMs/g,               'General Managers'],
  [/GM/g,                'General Manager'],
  [/[Aa]dmin(istrator)?s/g, 'Administrators'],
  [/[Aa]dmin(istrator)?(?!-)/g, 'Administrator'],
  [/Ops/g,               'Operations'],
  // Role names are always capitalized, e.g. "the Operations Manager".
  [/[Oo]perations manager(s?)/g, 'Operations Manager$1'],
  [/[Gg]eneral manager(s?)/g,    'General Manager$1'],
  [/[Ff]leet manager(s?)/g,      'Fleet Manager$1'],
]

export function expandText(text: string): string {
  return TEXT_TOKENS.reduce((s, [rx, rep]) => s.replace(rx, rep), text ?? '')
}
