/**
 * The driver app's query keys (all under the signed-in user, see useApiQuery).
 * One place so a screen that writes (a pull-to-refresh, a live signal) and a
 * screen that reads agree on the same key.
 */
export const qk = {
  driverBookings: (driverId: string) => ['driver-bookings', driverId] as const,
  booking:        (bookingId: string) => ['booking', bookingId] as const,
  trips:          (bookingId: string) => ['trips', bookingId] as const,
  timeline:       (bookingId: string) => ['timeline', bookingId] as const,
  driving:        (bookingId: string) => ['driving', bookingId] as const,
  reports:        () => ['reports'] as const,
  report:         (reportId: string) => ['report', reportId] as const,
  passkeys:       () => ['passkeys'] as const,
  inbox:          () => ['messaging', 'inbox'] as const,
  conversation:   (id: string) => ['messaging', 'conversation', id] as const,
  group:          (id: string) => ['messaging', 'group', id] as const,
  notifications:  (page: number) => ['notifications', page] as const,
  availability:   () => ['availability'] as const,
}
