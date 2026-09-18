/**
 * Where each role lands after signing in on mobile.
 *
 * Extracted from SignIn.tsx once passkey enrolment became a second way to reach
 * a signed-in state: the enrolment screen finishes with a session in hand and
 * has to route the same way the OTP and password paths do, and two copies of
 * this table would drift the first time a role was added.
 *
 * An unmapped role returns '/', which callers treat as "no mobile access" rather
 * than as a destination.
 */
export const MOBILE_ROLE_ROUTES: Record<string, string> = {
  admin:  '/admin',
  driver: '/driver',
}

export function getMobileRoute(role: string): string {
  return MOBILE_ROLE_ROUTES[role] ?? '/'
}
