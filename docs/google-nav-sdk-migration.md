# Google Navigation SDK — Migration Guide

Status: **SDK installed + screen implemented, behind a feature flag. Pending a
native dev build (and on-device verification).**
Default navigation remains the existing custom Mapbox + Google Routes stack
(flag defaults to `mapbox`).

Installed: `@googlemaps/react-native-navigation-sdk@0.16.1`,
`expo-build-properties`. Wired in `app.config.ts` (build properties + the custom
`plugins/with-google-nav.js` desugaring plugin). Screen:
`components/maps/GoogleNavigationScreenInner.tsx` (lazy-loaded by
`GoogleNavigationScreen.tsx`). **Not yet built/run natively** — see §6/§10.

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

## 3. Compatibility — verified (wrapper v0.16.1)

- ✅ **React Native 0.81.5 is explicitly supported** (supported list:
      0.83.1 / 0.82.1 / **0.81.5** / 0.80.3 / 0.79.6).
- ✅ **New Architecture is *required*** (Fabric + TurboModules) — and this app
      already has `newArchEnabled=true`. Do **not** disable New Arch.
- ⚠️ **No Expo config plugin ships with it.** Handled here with
      `expo-build-properties` (minSdk 24, iOS 16) + a custom
      `plugins/with-google-nav.js` for the mandatory desugaring (§6).
- ⚠️ **Native requirements:** Android `minSdkVersion 24`, **core-library
      desugaring** (`com.android.tools:desugar_jdk_libs_nio:2.0.4`); iOS
      **deployment target 16.0**; Google Play services on device.
- ✅ **`react-native-maps` removed.** It was unused (you use `@rnmapbox/maps`)
      and its `play-services-maps` clashed with the Maps classes the Nav SDK
      bundles → duplicate-class build failure. Removed; now `@rnmapbox/maps` +
      Nav SDK only. (See §6.4.)
- ⚠️ **iOS builds need a Mac or EAS Build** — Windows can't run `expo run:ios`.
      Android builds locally with `expo run:android`.

---

## 4. Reversibility model (in place)

The two providers are fully isolated and rollback is a flag:

- **Folder layout**: nav code is split into `components/maps/google/`,
  `components/maps/mapbox/` (incl. the Mapbox-only `useRoute`, `useGps`,
  `cache`), and `components/maps/shared/` (`BookingDetailsScreen`,
  `ManueverIcon`, `BottomSheet`, `StopRow`). Provider-agnostic `theme/`,
  `types/`, `utils/geo`, and `lib/` stay at the top level.
- **Feature flag**: [`lib/config/featureFlags.ts`](../lib/config/featureFlags.ts)
  reads `EXPO_PUBLIC_NAV_PROVIDER`. **Default `google`** renders the Google
  path; `EXPO_PUBLIC_NAV_PROVIDER=mapbox` renders the existing
  [`NavigationScreen`](../components/maps/mapbox/NavigationScreen.tsx). Both
  SDKs are linked into the one native build, so this is a runtime switch
  (change the var + reload JS; no native rebuild required).
- **Route switch**: [`app/driver/maps/[bookingId]/index.tsx`](../app/driver/maps/%5BbookingId%5D/index.tsx)
  picks the screen from `getNavProvider()`.
- **Custom stack untouched**: the Mapbox `useRoute`, `useGps`, `geo`, `cache`,
  `NavigationScreenMapInner` keep their original behavior (only their import
  paths changed in the reorg).
- **Graceful load**: each wrapper lazy-loads its inner screen; if the native
  module isn't built yet it shows setup guidance instead of crashing — so the
  bundle builds even before a native dev build.

**Git rollback (recommended baseline):**

```sh
# from logistics-mobile/
git checkout -b feat/google-nav-sdk      # do the migration here
# ...work...
git checkout develop                     # abandon = back to the proven stack
```

---

## 5. Install — done

Already installed on the `feat/google-nav-sdk` branch:

```sh
# from logistics-mobile/
npm install @googlemaps/react-native-navigation-sdk   # v0.16.1
npx expo install expo-build-properties                # native build config
```

> These add to `package.json`/`package-lock.json` (left uncommitted alongside a
> pre-existing `expo-updates` change). Commit them when you commit your own deps.

---

## 6. Native config

Since the SDK ships **no Expo config plugin**, the native requirements are wired
in [`app.config.ts`](../app.config.ts) as:

```ts
['expo-build-properties', { android: { minSdkVersion: 24 }, ios: { deploymentTarget: '16.0' } }],
'./plugins/with-google-nav',   // adds Android core-library desugaring
```

`plugins/with-google-nav.js` injects the mandatory desugaring into
`android/app/build.gradle`:

```groovy
compileOptions { coreLibraryDesugaringEnabled true }
dependencies   { coreLibraryDesugaring 'com.android.tools:desugar_jdk_libs_nio:2.0.4' }
```

### 6.1 API keys

- **Android:** already handled — your existing `android.config.googleMaps.apiKey`
  injects `com.google.android.geo.API_KEY`, which the Nav SDK uses. Just ensure
  that key has **Navigation SDK** enabled in the Cloud Console.
- **iOS:** the Nav SDK needs `GMSServices.provideAPIKey(...)` in the AppDelegate.
  Your `ios.config.googleMapsApiKey` + `react-native-maps` may already inject
  this. **After prebuild, verify `GMSServices.provideAPIKey` exists exactly once
  in `ios/.../AppDelegate`** — if missing, add it via a small `withAppDelegate`
  mod in `plugins/with-google-nav.js` (guard against a double call).

### 6.2 Permissions

The Nav SDK needs foreground (and, for background guidance, background) location.
You already request foreground location in [`useGps`](../hooks/useGps.ts). Ensure
`Info.plist` has `NSLocationWhenInUseUsageDescription` (+
`NSLocationAlwaysAndWhenInUseUsageDescription` if backgrounding) and Android has
`ACCESS_FINE_LOCATION`.

### 6.3 Prebuild + build (⚠️ not yet run — do this on a build machine)

```sh
npx expo prebuild --clean          # regenerate native projects with the plugins
npx expo run:android               # local Android dev build (Windows OK)
# iOS: use a Mac (npx expo run:ios) or EAS Build (eas build -p ios)
```

### 6.4 Build issues hit + fixes (Android, resolved)

First Android dev build surfaced two issues, both now fixed:

1. **`core library desugaring ... requires ... to be enabled`** — the RN 0.81
   Expo template ships **no `compileOptions` block**, so the desugaring *flag*
   had nothing to anchor to (only the dependency was added). Fix:
   `plugins/with-google-nav.js` now injects a fresh `compileOptions { ... }`
   inside `android {}` when none exists.
2. **`Duplicate class com.google.android.gms.maps.*`** between
   `navigation-7.6.1` and `play-services-maps-18.2.0` — the Nav SDK bundles the
   Maps classes, and the unused `react-native-maps` pulled in `play-services-maps`.
   Fix: `npm uninstall react-native-maps` (it had **zero source imports**), then
   regenerate native: **`npx expo prebuild --clean`** (required after removing a
   native module) → `npx expo run:android`.

> Other native bits (iOS `GMSServices` key, on-device run) are still unverified.

---

## 7. The Google nav screen (implemented)

The integration lives in two files (written + **tsc-verified** against the
v0.16.1 type defs):

- [`GoogleNavigationScreen`](../components/maps/GoogleNavigationScreen.tsx) —
  lazy-loads the Inner; shows setup guidance if the native module is absent.
- [`GoogleNavigationScreenInner`](../components/maps/GoogleNavigationScreenInner.tsx)
  — the real SDK screen.

How it maps to the **verified** API:

- Wrap in **`<NavigationProvider termsAndConditionsDialogOptions={{ title, companyName }}>`**;
  call **`useNavigation()`** inside it for `navigationController` + listener setters.
- Accept ToS (`areTermsAccepted()` → `showTermsAndConditionsDialog()`), then
  **`init()`** → **`setDestinations(waypoints)`** → **`startGuidance()`**.
- **`Waypoint`** is `{ position: { lat, lng }, title? }` — there is **no custom
  metadata field**, so arrivals map to stops by **sequence index** (navigation is
  strictly ordered via `continueToNextDestination()`).
- Register **`setOnArrival(cb)`** (event carries `isFinalDestination`); on each
  arrival, PATCH the matching leg (pickup → `in_transit`, dropoff → `delivered`),
  then `continueToNextDestination()`.
- Render **`<NavigationView style={{ flex: 1 }} />`**; on unmount call
  `removeAllListeners()` + `stopGuidance()` + `cleanup()`.

> On-device tuning to expect: duplicate arrival callbacks are guarded by a
> processed-index set; failed PATCHes currently fire-and-forget — add
> rollback/retry to match the custom stack if the field needs it.

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

## 12. Open items

Resolved:
- ✅ Navigation SDK **access enabled** on the Google project. (§2)
- ✅ Wrapper supports **RN 0.81.5 + New Architecture** (required; already on). (§3)
- ✅ **API verified** against v0.16.1 type defs; screen implemented. (§7)
- ✅ Arrival→stop mapping resolved: **by sequence index** (no waypoint metadata). (§7)

Still to confirm:
1. **Run a native build** (`expo prebuild --clean` + `expo run:android`) — the
   native config (desugaring plugin, iOS 16, API keys) is **not build-verified**. (§6)
2. **iOS `GMSServices.provideAPIKey`** present exactly once after prebuild. (§6.1)
3. Confirm the Android API key has **Navigation SDK** enabled (not just Maps). (§6.1)
4. Does **web `/directions`** stay (other consumers)? (§8)
5. **Pricing** confirmed for fleet size vs current per-request Routes+Mapbox cost.
6. **On-device behavior:** offline gap handling, app size/cold-start, arrival
   PATCH reliability. (§9–10)
