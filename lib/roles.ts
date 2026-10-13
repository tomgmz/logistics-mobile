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

// Short forms people still type when searching for a role, though the UI never
// shows them.
const ROLE_SEARCH_ALIASES: Record<string, string> = {
  admin:              'admin',
  it_admin:           'it admin',
  general_manager:    'gm',
  operations_manager: 'ops',
  fleet_manager:      'fleet',
}

/** Everything a role can be searched by, lowercased: "company administrator", "operations manager", "gm". */
export function roleSearchText(role: string | null | undefined): string {
  if (!role) return ''
  return [roleLabel(role), role.replace(/_/g, ' '), ROLE_SEARCH_ALIASES[role] ?? '']
    .join(' ')
    .toLowerCase()
}

/** Whether a person matches a search box query, by name or by role. */
export function matchesPersonSearch(
  query: string,
  person: { first_name?: string | null; last_name?: string | null; role?: string | null },
): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  const name = `${person.first_name ?? ''} ${person.last_name ?? ''}`.toLowerCase()
  return name.includes(q) || roleSearchText(person.role).includes(q)
}

/**
 * A person's name with their role, as messaging shows it:
 * "Tom Ervin Gomez (Company Administrator)". No role, just the name.
 */
export function nameWithRole(
  first: string | null | undefined,
  last: string | null | undefined,
  role: string | null | undefined,
): string {
  const name  = `${first ?? ''} ${last ?? ''}`.trim()
  const label = roleLabel(role)
  return label ? `${name} (${label})` : name
}
