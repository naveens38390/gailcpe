# GCPE Frontend — Mobile App

## 1. Project Overview and Purpose

This is the mobile application for the GAIL Competitive Pricing Engine (GCPE) — the tool a sales or pricing officer opens on their phone to answer, in seconds, a question that used to take an afternoon in a spreadsheet: *"Where does GAIL's price stand against RIL, IOCL, HMEL, OPaL and HPL for this grade, at this customer's location, today?"*

The app is a presentation layer only — it performs no pricing arithmetic itself. Every number shown is fetched from the backend API and displayed as returned, so a figure quoted from a phone in the field is guaranteed to match what the pricing team would calculate from the same inputs.

It is built with [Expo](https://expo.dev/) and [Expo Router](https://docs.expo.dev/router/introduction/), so the same codebase runs on iOS, Android, and the web.

## 2. Key Features and Functionality

The app is organised as a drawer with two destinations: the day-to-day **Pricing** tabs, and the **Admin Panel** for master data.

**Pricing tabs**

| Tab | Purpose |
|---|---|
| **Compare** | The core screen. Select a grade, a customer location, a quantity and payment terms; see a landed-cost comparison across GAIL and every competitor that can price that grade there, with a clear "ahead/behind" verdict and a full price breakdown (basic price, cash discount, freight, quantity discount) per producer. |
| **Deal** | The Deal Simulator. For the same inputs, shows where GAIL stands today and what a set of price corrections (hold, partial concession, match the leader, undercut the leader) would cost and whether each would actually win the order — with a plain-language narrative an officer can defend to a manager. |
| **Grades** | Grade Finder. Search by GAIL grade code, a competitor's code, or what the grade is used for, and see every producer's equivalent grade, its specifications, and (where relevant) international equivalents. |
| **Freight** | Freight Intelligence. Pick a destination and see every producer's freight rate there, which producer is cheapest, and how confidently that destination was matched to each producer's pricing zone. |
| **Circulars** | A browsable, versioned repository of every price and freight circular loaded into the system, grouped by "round" (effective date). |
| **Corrections** | Propose and decide one-off corrections to a single GAIL price, with a required reason, a before/after price, and a full history of who proposed and who decided each one. |

**Admin Panel** (see §9 for detail): master-data management for Producers, Locations, Grade Mappings, Discount Terms and Price Circulars, plus generated Excel/PDF reports.

**Other app-wide behaviour**

- Automatic, silent sign-in on launch — there is no login screen for day-to-day use (see §6).
- Light/dark theme, following the device by default, switchable from the drawer footer and persisted between sessions.
- The picker data behind every dropdown (grades, locations, producers) is loaded once per session directly from the currently published dataset, so a value on screen is guaranteed to exist in a live circular.

## 3. Technology Stack

| Layer | Technology |
|---|---|
| Framework | [Expo](https://expo.dev/) (SDK 57), React Native 0.86 |
| Language | TypeScript |
| Routing | [Expo Router](https://docs.expo.dev/router/introduction/) (file-based routing, drawer + tabs + stack navigation) |
| UI | React Native core components, `@expo/vector-icons` (Ionicons), `react-native-svg` |
| Lists | `@shopify/flash-list` |
| Storage | `@react-native-async-storage/async-storage` (theme preference only — no pricing data is cached on device) |
| Gestures / animation | `react-native-gesture-handler`, `react-native-reanimated`, `react-native-worklets` |
| File sharing | `expo-file-system`, `expo-sharing` (for downloading exported reports) |
| Platforms | iOS, Android, and Web (via `react-native-web` / Metro) |

## 4. Project Structure

```
frontend/
  app.json                  Expo app configuration (name, icons, splash screen, bundler)
  package.json
  src/
    app/                    Routes only — file-based routing via Expo Router
      _layout.tsx             Root layout: providers, the drawer (Pricing | Admin Panel), session overlay
      (tabs)/                 The pricing tab group
        _layout.tsx            Tab bar definition and order
        index.tsx               Compare
        deal.tsx                 Deal Simulator
        grades.tsx               Grade Finder
        freight.tsx              Freight Intelligence
        circulars.tsx            Circular repository
        corrections.tsx          Price Corrections
      admin/                   The Admin Panel stack
        _layout.tsx              Stack definition and the Admin Panel lock overlay
        index.tsx                Admin Panel home — module list and reports
        producers.tsx, locations.tsx, grades.tsx, discounts.tsx,
        price-book.tsx, price-circulars.tsx, price-circular/[id].tsx
    components/              Shared presentational components
      ui.tsx                   Card, SectionTitle, Pill, Caveat, Empty state, error/loading notes
      inputs.tsx                Field, Input, PaymentToggle, PrimaryButton, autocomplete suggestions
      select.tsx                 Searchable single/multi-select pickers used throughout
      dataGrid.tsx               Tabular data browsing (used in the Admin Panel)
      masterData.tsx             Shared Draft/Review/Approve/Publish UI for master-data modules
      priceLadder.tsx             The visual price-ladder / comparison chart
      DrawerContent.tsx           Custom drawer contents, including the dark-mode switch
      adminLock.tsx               The Admin Panel's credential-gate overlay
      launchScreen.tsx             Startup/loading/error overlay
    services/
      api.ts                    The only place the app talks to the backend — every endpoint call,
                                 base-URL resolution, and the silent sign-in
      download.ts                Downloads/shares an exported report file
    context/
      auth.tsx                   The silent, single-account session
      adminGate.tsx               Admin Panel unlock state
      catalog.tsx                 Picker data (grades/locations/producers), loaded once per session
      theme.tsx                   Light/dark theme state, persisted, plus the makeStyles/useTheme hooks
    constants/colors.ts         The single source of truth for every colour, light and dark
    theme.ts                   Spacing, radii, and shared number/currency formatting helpers
```

## 5. Setup and Installation

### Prerequisites

- Node.js 18+ and npm
- The [Expo Go](https://expo.dev/go) app on a physical device, and/or Xcode (iOS Simulator) / Android Studio (Android Emulator) for local testing
- A running instance of the GCPE backend API (see the backend README) — the app has nothing to show without it

### Install

```bash
cd frontend
npm install
```

## 6. Environment / Configuration Requirements

The app is configured entirely through Expo public environment variables (prefixed `EXPO_PUBLIC_`, readable by the client bundle):

| Variable | Required | Purpose |
|---|---|---|
| `EXPO_PUBLIC_API_URL` | No, for local development | Base URL of the backend API. If unset, the app derives the API address automatically from the Expo dev server it was loaded from (so a phone on the same Wi-Fi as the developer's machine reaches the API with no configuration). Set this explicitly to point a build at a staging or production API. |
| `EXPO_PUBLIC_ADMIN_EMAIL` | No | Overrides the built-in administrator account's email used for automatic sign-in. |
| `EXPO_PUBLIC_ADMIN_PASSWORD` | No | Overrides the built-in administrator account's password used for automatic sign-in. |

**How sign-in works.** There is no login screen. The app is configured with one administrator account and authenticates with it silently on launch against the backend's `/auth/login` endpoint, landing the user directly on the Compare screen. The Admin Panel additionally requires re-entering that same password before it will open (see §9) — this second check is verified against the live backend, not stored on the device.

**Security note.** Because the sign-in credentials are compiled into the app bundle, they should always be overridden from their defaults via `EXPO_PUBLIC_ADMIN_EMAIL` / `EXPO_PUBLIC_ADMIN_PASSWORD` (matching whatever `ADMIN_PASSWORD` the backend was configured with) before distributing a build outside a trusted environment, and the backend should not be exposed on a network you do not control.

## 7. Running the Project

```bash
cd frontend
npx expo start
```

This starts the Expo development server and prints a QR code:

- Scan it with the **Expo Go** app on a physical device (same Wi-Fi network as the development machine).
- Press `i` to launch the iOS Simulator, or `a` for the Android Emulator.
- Press `w` to run in a browser.

Platform-specific shortcuts are also available directly:

```bash
npm run android
npm run ios
npm run web
```

Type-check the project without building:

```bash
npm run typecheck
```

Make sure the backend API is running first (see the backend README) — with no API reachable, the app will show a retryable "could not reach the pricing service" screen instead of Compare.

## 8. Build / Deployment Instructions

This project uses Expo's standard build tooling. In outline:

1. Set `EXPO_PUBLIC_API_URL` (and the admin override variables, if applicable) for the target environment — typically via an EAS build profile or a `.env` file consumed at build time.
2. Build with [EAS Build](https://docs.expo.dev/build/introduction/) (`eas build --platform ios|android`) for native app-store binaries, or `npx expo export` for a static web build (the project is configured with `"output": "single"` for web).
3. Distribute the resulting binary through the App Store / Play Store / your internal distribution channel, or host the exported web build behind your usual static hosting.

The app has no server-side component of its own to deploy — only the compiled client and the environment variables baked into it at build time.

## 9. Admin Panel Details

The Admin Panel is reached from the app's drawer (swipe from the left edge, or tap the ☰ button) and is kept separate from the day-to-day Pricing tabs because everything in it writes to the published dataset.

**Access.** The panel is locked behind the administrator's password on every app launch — closing the app re-locks it, and the unlock state is held only in memory, never written to device storage. The check is a real API call (`/auth/login`), not a local comparison, so an incorrect password is rejected by the backend.

**What it contains**, from the Admin Panel home screen:

| Module | What it manages |
|---|---|
| **Producers** | GAIL and the five tracked competitors (RIL, IOCL, HMEL, OPaL, HPL) |
| **Locations** | Every customer location and how it maps to each producer's pricing zones |
| **Grade Mappings** | GAIL grades, their competitor equivalents, and mapping confidence |
| **Discount Terms** | Cash discount, early-payment terms, interest-free credit days, and quantity slabs, per producer |
| **Price Book** | Read-only browse/search of GAIL's full live price matrix |
| **Price Circulars** | Create a new draft circular (cloned from the current live price book), bulk-edit or edit individual rows, then submit it through review to publish |

Every module except Price Book follows the same workflow: **Draft → Review → Approved → Published**, with a **Pending** view inside each module for changes awaiting a decision. A change proposed here does not affect anything the Pricing tabs show until it is published, and every step — draft, submission, approval/rejection, publish, and any rollback to a prior version — is recorded against the account that took it.

**Reports**, generated fresh from published data every time a report is requested: the Discount Circular (GAIL vs. every other producer's latest terms), Grade Mapping, and Location Master, each downloadable as Excel (and PDF, for circular-specific reports).

## 10. Important Dependencies and Integrations

- **The GCPE backend API** — the app's only external integration. All data, authentication, and reporting flow through `src/services/api.ts`; there is no other data source and no offline/cached copy of pricing data.
- **Expo Router** — drives all navigation: the root drawer, the pricing tab group, and the Admin Panel's own stack are each defined by the file layout under `src/app`.
- **AsyncStorage** — used for exactly one thing: remembering the user's light/dark theme preference between sessions.
- **Ionicons (`@expo/vector-icons`)** — the app's icon set throughout the drawer, tabs, and UI components.

## 11. Data Flow and Architecture Overview

```
App launch
   │
   ▼
AuthProvider → silent sign-in against POST /auth/login (built-in admin account)
   │
   ▼
CatalogProvider → GET /catalog (producers, grades, locations for every picker) — loaded once per session
   │
   ▼
User selects grade / location / quantity / terms on a Pricing tab
   │
   ▼
services/api.ts → the relevant endpoint (e.g. POST /pricing/compare, POST /deals/simulate,
                    GET /freight, GET /grades/search)
   │
   ▼
Screen renders exactly what the API returned — no calculation happens on the device
```

Every screen follows the same shape: gather input via the shared `Field`/`SelectField`/`ChipMulti` components (fed from the catalog so only values that actually exist in a published circular can be selected), call one `services/api.ts` function, and render the response through the shared `Card`/`PriceLadder`/`Caveat` components. This keeps every screen a thin presentation layer over the backend's netback engine, and keeps warnings, gaps, and confidence indicators (e.g. an inferred location match, or a grade mapped with less than full confidence) visible wherever the backend reports them rather than hidden.

The Admin Panel follows a parallel but separate flow: its screens call the master-data endpoints (`producers`, `locations`, `grades`, `discounts`, `price-circulars`) which implement the Draft → Review → Approved → Published workflow described in §9, rather than the read-only pricing endpoints the tabs use.

## 12. Troubleshooting / Common Issues

**App is stuck on the launch screen, or shows "could not reach the pricing service."**
The app cannot reach the backend API. Confirm the backend is running (see the backend README) and, if testing on a physical device, that the device is on the same Wi-Fi network as the development machine so automatic API-address detection works. If it still fails, set `EXPO_PUBLIC_API_URL` explicitly to the backend's reachable address and restart the Expo dev server.

**Sign-in fails immediately on launch.**
The app's configured admin email/password (default, or overridden via `EXPO_PUBLIC_ADMIN_EMAIL` / `EXPO_PUBLIC_ADMIN_PASSWORD`) does not match what the backend was seeded with (`ADMIN_PASSWORD`). Ensure both sides agree, and that the backend has actually been seeded (`npm run seed` in `backend/api`).

**Admin Panel won't unlock even with the correct-looking password.**
The unlock check hits the live backend, so this usually means either the password genuinely doesn't match the backend's admin account, or the backend is unreachable — check for a network error rather than assuming the password is wrong.

**A location or grade I expect to see isn't in the picker.**
Pickers are populated from `GET /catalog`, which only reflects the currently *published* dataset. A location or grade added in the Admin Panel but not yet published will not appear. Also check whether the grade is priced at that location at all — the Compare and Deal screens narrow the location list to what the selected grade can actually price.

**Metro bundler / Expo cache issues after pulling new dependencies.**
Clear the cache and restart:
```bash
npx expo start -c
```

**Changes to `EXPO_PUBLIC_*` variables don't seem to take effect.**
These are baked in at bundle time. Fully restart the Expo dev server (not just reload the app) after changing them, and rebuild for a native build.

**Exported report (Excel/PDF) doesn't download or share on device.**
This depends on `expo-file-system` / `expo-sharing` support on the platform/simulator in use — verify on a physical device or a simulator with sharing support, and confirm the Admin Panel export request itself succeeded (check for an error note on screen).
