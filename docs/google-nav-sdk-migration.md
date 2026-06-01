# Google Navigation SDK — Migration Guide

Status: **scaffolded, behind a feature flag, not yet active.**
Default navigation remains the existing custom Mapbox + Google Routes stack.

This guide is the single source of truth for trialing the Google Navigation SDK
for driver turn-by-turn navigation, and for rolling back cleanly if it doesn't
fit. It reflects the repo as configured today: **Expo 54, React Native 0.81.5,
React 19, New Architecture ENABLED**.

---

## 1. Why this exists / decision context

The driver nav today is a **custom stack**:

- `POST /directions` (backend) → Google **Routes API** for routing + traffic,
  then a Mapbox map-matching snap ([directions.service.ts](../../logistics-backend/src/services/maps/directions.service.ts)).
- Client-side polyline decode, road-snapping, off-route detection, rerouting,
  and offline tile/route caching in
  [`useRoute`](../hooks/useRoute.ts), [`useGps`](../hooks/useGps.ts),
  [`geo`](../utils/geo.ts), [`cache`](../utils/cache.ts).

The Google Navigation SDK is a **native turn-by-turn engine**: it does
road-snapping, voice, lane guidance, and automatic rerouting natively, so we
stop maintaining that logic. Tradeoffs that drove the "trial behind a flag"
decision:

| Concern | Custom stack (current) | Google Nav SDK |
| --- | --- | --- |
| PH routing + traffic quality | ✅ Google Routes (strong in PH) | ✅ Google (strong in PH) |
| Guaranteed offline (pre-download per stop) | ✅ Yes ([cache.ts](../utils/cache.ts)) | ❌ No offline-region download API; only gap-tolerance on a loaded route |
| Snapping / smoothness | ⚠️ Hand-rolled | ✅ Native, polished |
| Voice / lane guidance | ❌ Not built | ✅ Built in |
| You own edge cases | Yes, forever | No (vendor) |

**Key accepted limitation:** the Google Nav SDK has **no developer-facing
offline-region download** (that's the consumer Google Maps app feature, not the
SDK). It can continue guidance through brief signal gaps on an already-loaded
route, but it cannot pre-cache a stop's map/route or reroute offline. If field
drivers regularly hit dead zones, keep the custom stack as the fallback (it is
retained — see §4).

---

## 2. ⚠️ Prerequisite gate (do this BEFORE any code)

The Navigation SDK is **NOT** the same product as the Maps SDK
(`react-native-maps`, already installed). It is **gated**:

1. **Request Navigation SDK access / accept the Mobility agreement** for your
   Google Cloud project. A standard Maps API key will **not** authorize the
   Navigation SDK. Start at:
   https://developers.google.com/maps/documentation/navigation
2. **Enable billing** and the Navigation SDK SKUs (separate, pricier pricing —
   typically per monthly-active-user or per-trip). Confirm the cost model with
   Google for your fleet size.
3. **Create / authorize an API key** for the Navigation SDK on both Android and
   iOS application restrictions.

> If access cannot be obtained, **stop here** — the wrapper will not function,
> and the right move is to fix the custom stack instead (snap puck + trim line).

---

## 3. Compatibility checklist (verify before installing)

- [ ] `@googlemaps/react-native-navigation-sdk` supports **React Native 0.81**.
- [ ] It supports the **New Architecture** (this app has
      `newArchEnabled=true` in `android/gradle.properties`). If the wrapper does
      not support New Arch, that is a blocker — do not disable New Arch app-wide
      without checking the rest of the app (Reanimated 4, Mapbox, etc. depend on it).
- [ ] It ships an **Expo config plugin** (or we write one) — this is a bare
      native module; it cannot run in Expo Go and needs a prebuild/dev build.
- [ ] **Three map libs coexisting** is acceptable for now: `@rnmapbox/maps`,
      `react-native-maps`, and the Nav SDK. Watch app size + Android
      `minSdk`/Play-services conflicts. Long term, consider dropping
      `react-native-maps` if unused elsewhere.
- [ ] **iOS builds require a Mac or EAS Build** — Windows cannot run
      `expo run:ios`. Android can be built locally with `expo run:android`.

---

## 4. Reversibility model (already in place)

The scaffold is built so the **working nav never breaks** and rollback is a flag:

- **Feature flag**: [`lib/config/featureFlags.ts`](../lib/config/featureFlags.ts)
  reads `EXPO_PUBLIC_NAV_PROVIDER`. Default (`mapbox`) renders the existing
  [`NavigationScreen`](../components/maps/NavigationScreen.tsx). Only
  `EXPO_PUBLIC_NAV_PROVIDER=google` renders the Google path.
- **Route switch**: [`app/driver/maps/[bookingId]/index.tsx`](../app/driver/maps/%5BbookingId%5D/index.tsx)
  picks the screen from the flag. Custom stack is the default branch.
- **Custom stack untouched**: `useRoute`, `useGps`, `geo`, `cache`,
  `NavigationScreenMapInner` are not modified by this migration.
- **Placeholder**: [`GoogleNavigationScreen`](../components/maps/GoogleNavigationScreen.tsx)
  renders guidance until the SDK + Inner screen are added, so the bundle keeps
  building with the flag on but the SDK absent.

**Git rollback (recommended baseline):**

```sh
# from logistics-mobile/
git checkout -b feat/google-nav-sdk      # do the migration here
# ...work...
git checkout develop                     # abandon = back to the proven stack
```

---

## 5. Install

```sh
# from logistics-mobile/
npm install @googlemaps/react-native-navigation-sdk
# verify the installed version's README for the exact API + native setup
```

---

## 6. Native config

### 6.1 API key (app.config.ts)

You already inject `EXPO_PUBLIC_GOOGLE_MAPS_API_KEY` for the Maps SDK
([app.config.ts](../app.config.ts)). The **same key must be authorized for the
Navigation SDK** (or add a dedicated `EXPO_PUBLIC_GOOGLE_NAV_API_KEY`). Add the
wrapper's config plugin to the `plugins` array, e.g.:

```ts
plugins: [
  // ...existing...
  [
    '@googlemaps/react-native-navigation-sdk',
    {
      androidApiKey: process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY,
      iosApiKey:     process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY,
    },
  ],
],
```

> Confirm the plugin name + option keys against the installed wrapper's README;
> some versions require manual `AndroidManifest`/`Info.plist` edits instead of a
> plugin. If no plugin is provided, a small custom Expo config plugin is needed.

### 6.2 Permissions

The Nav SDK needs foreground (and for background guidance, background) location.
You already request foreground location in [`useGps`](../hooks/useGps.ts) via
`expo-location`. Ensure `Info.plist` has
`NSLocationWhenInUseUsageDescription` (and `NSLocationAlwaysAndWhenInUseUsageDescription`
if backgrounding) and Android has `ACCESS_FINE_LOCATION`.

### 6.3 Prebuild

```sh
npx expo prebuild --clean          # regenerate native projects with the plugin
npx expo run:android               # local Android dev build (Windows OK)
# iOS: use a Mac (npx expo run:ios) or EAS Build (eas build -p ios)
```

---

## 7. The Google nav screen

> ⚠️ **API names below are representative.** The
> `@googlemaps/react-native-navigation-sdk` API evolves between versions —
> verify every component/hook/method name and event signature against the
> README of the version you installed. The **shape** of the integration is what
> matters here.

Create `components/maps/GoogleNavigationScreenInner.tsx` with the real SDK, then
update [`GoogleNavigationScreen`](../components/maps/GoogleNavigationScreen.tsx)
to lazy-load it (mirroring the dynamic-import + native-link guard in
[`NavigationScreen.tsx`](../components/maps/NavigationScreen.tsx)).

```tsx
// components/maps/GoogleNavigationScreenInner.tsx
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { View } from 'react-native'
import {
  NavigationView,
  useNavigation,
  type Waypoint,
} from '@googlemaps/react-native-navigation-sdk'

import api from '../../lib/api/auth.api'

interface Props { bookingId: string }

export default function GoogleNavigationScreenInner({ bookingId }: Props) {
  const { navigationController, addListeners, removeListeners } = useNavigation()
  const [ready, setReady] = useState(false)
  const arrivedStops = useRef<Set<string>>(new Set())
  const pickedUp = useRef(false)

  // 1) Pull stop coordinates from YOUR backend (the SDK has no concept of bookings).
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const { data } = await api.get(`/booking/${bookingId}`)
      const booking = data.data

      const pickedUpAlready = ['in_transit', 'completed'].includes(booking.status)
      pickedUp.current = pickedUpAlready

      const stops = (booking.booking_destinations ?? [])
        .filter((d: any) => d.latitude != null && d.longitude != null && d.status === 'pending')
        .sort((a: any, b: any) => a.sequence_order - b.sequence_order)

      // Before pickup, route to origin first; after, straight to remaining stops.
      const waypoints: Waypoint[] = [
        ...(!pickedUpAlready
          ? [{ title: 'Pickup', position: { lat: booking.origin_latitude, lng: booking.origin_longitude } }]
          : []),
        ...stops.map((s: any) => ({
          title: s.address,
          position: { lat: s.latitude, lng: s.longitude },
          // carry your id so arrival events can be mapped back to the stop:
          // some wrapper versions expose this via metadata/placeId — confirm.
        })),
      ]
      if (cancelled || waypoints.length === 0) return

      await navigationController.init()
      await navigationController.setDestinations(waypoints)
      await navigationController.startGuidance()
      setReady(true)
    })()
    return () => { cancelled = true }
  }, [bookingId, navigationController])

  // 2) Map SDK arrival events back to YOUR backend status updates.
  const onArrival = useCallback(async (event: any) => {
    // Determine whether this arrival is the pickup or a dropoff (use the
    // waypoint title/index/metadata you set above).
    if (!pickedUp.current) {
      pickedUp.current = true
      await api.patch(`/booking/${bookingId}/status`, { status: 'in_transit' }).catch(() => {})
      return
    }
    const stopId = event?.waypoint?.metadata?.destination_id // confirm shape
    if (stopId && !arrivedStops.current.has(stopId)) {
      arrivedStops.current.add(stopId)
      await api
        .patch(`/booking-destinations/${stopId}/status`, { status: 'delivered' })
        .catch(() => { arrivedStops.current.delete(stopId) /* allow retry */ })
    }
    // Advance to the next waypoint if the wrapper doesn't auto-continue.
    await navigationController.continueToNextDestination?.()
  }, [bookingId, navigationController])

  useEffect(() => {
    const listeners = { onArrival }
    addListeners(listeners)
    return () => removeListeners(listeners)
  }, [addListeners, removeListeners, onArrival])

  return (
    <View style={{ flex: 1 }}>
      <NavigationView style={{ flex: 1 }} onMapReady={() => {}} />
    </View>
  )
}
```

Then wire the lazy load in `GoogleNavigationScreen.tsx` (replace the placeholder
body), following the `NavigationScreen.tsx` pattern:

```tsx
import('./GoogleNavigationScreenInner')
  .then((m) => setInner(() => m.default))
  .catch(() => setLoadErr('Could not load Google nav — is the SDK installed + prebuilt?'))
```

---

## 8. Backend wiring (what stays the same)

The backend is **not replaced** — only the mobile routing source changes:

- **Still used:** `GET /booking/:id` (source of stop coordinates fed into the
  SDK), `PATCH /booking/:id/status` (pickup → `in_transit`),
  `PATCH /booking-destinations/:id/status` (delivery → `delivered`), all auth,
  messaging, presence.
- **No longer used by mobile:** `POST /directions` and the Mapbox map-matching
  snap. **Check whether `logistics-frontend` (web) still calls `/directions`
  before removing it** — if so, the endpoint stays for the web app.

Arrival → status mapping is the critical integration point: the SDK reports
"arrived at waypoint"; you translate that into the two PATCH calls above (with
failure rollback, matching the custom stack's behavior).

---

## 9. Offline behavior (set expectations)

- The SDK keeps guiding along an **already-loaded route** through brief signal
  drops, but **cannot reroute offline** and **cannot pre-download** a region.
- The custom stack's offline tile packs ([cache.ts](../utils/cache.ts)) do **not**
  apply to the SDK. If guaranteed offline is required for some routes, run those
  on the custom stack (flag off) — both can coexist per-driver/per-route via the
  env flag.

---

## 10. Test checklist (on a real device, dev build)

- [ ] Flag off (`EXPO_PUBLIC_NAV_PROVIDER` unset) → existing Mapbox nav loads (regression check).
- [ ] Flag on → Google nav loads, shows the route to the first stop.
- [ ] Pickup arrival fires `PATCH /booking/:id/status = in_transit`.
- [ ] Each delivery arrival fires `PATCH /booking-destinations/:id/status = delivered`.
- [ ] Multi-stop sequence advances correctly through all waypoints.
- [ ] Off-route → SDK reroutes automatically (no custom logic).
- [ ] Failed PATCH does not permanently desync (rollback retries).
- [ ] Lose signal mid-route → guidance continues on the loaded route; confirm
      acceptable behavior for your field conditions.
- [ ] App size + cold-start acceptable with the extra native SDK.

---

## 11. Rollback

1. Set `EXPO_PUBLIC_NAV_PROVIDER` back to unset/`mapbox` → instant return to the
   custom stack (no rebuild needed for the flag itself).
2. To remove entirely: `git checkout develop` (or delete
   `GoogleNavigationScreen*.tsx`, `lib/config/featureFlags.ts`, revert the route
   switch, and `npm uninstall @googlemaps/react-native-navigation-sdk` +
   `expo prebuild --clean`).

The custom stack is never modified, so rollback always lands on a working app.

---

## 12. Open items to confirm (don't skip)

1. **Navigation SDK access** approved for the Google project? (§2)
2. Wrapper supports **RN 0.81 + New Architecture**? (§3)
3. Exact wrapper **API names + config plugin** for the installed version. (§6–7)
4. How the wrapper exposes **per-waypoint metadata** so arrivals map to your
   `destination_id`. (§7)
5. Does **web `/directions`** stay (other consumers)? (§8)
6. **Pricing** confirmed for fleet size vs current per-request Routes+Mapbox cost.
