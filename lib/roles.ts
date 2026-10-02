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
  [/\b(Fleet|Operations) Admin(istrator)?s\b/g, '$1 Managers'],
  [/\b(Fleet|Operations) Admin(istrator)?\b/g,  '$1 Manager'],
  [/\bselected by operations\b/g,              'selected by the Operations Manager'],
  [/\bGMs\b/g,               'General Managers'],
  [/\bGM\b/g,                'General Manager'],
  [/\b[Aa]dmin(istrator)?s\b/g, 'Administrators'],
  [/\b[Aa]dmin(istrator)?\b(?!-)/g, 'Administrator'],
  [/\bOps\b/g,               'Operations'],
  // Role names are always capitalized, e.g. "the Operations Manager".
  [/\b[Oo]perations manager(s?)\b/g, 'Operations Manager$1'],
  [/\b[Gg]eneral manager(s?)\b/g,    'General Manager$1'],
  [/\b[Ff]leet manager(s?)\b/g,      'Fleet Manager$1'],
]

export function expandText(text: string): string {
  return TEXT_TOKENS.reduce((s, [rx, rep]) => s.replace(rx, rep), text ?? '')
}
