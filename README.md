# GCPE — GAIL PE Competitive Pricing Engine

Turns the 14 circulars in `D:\Gail` into a queryable dataset and a netback
engine, so a comparison that currently takes an analyst an afternoon in Excel
takes a lookup.

## Status

| Layer | State |
|---|---|
| ETL — all 14 source files → normalized JSON | working — 51,930 prices, 6 producers |
| Netback engine (grade + location + quantity + terms → landed cost) | working |
| MZO acceptance test | 92 of 124 rows reproduced; every deviation attributed |
| NestJS API — auth, grades, pricing, freight, deals, circulars | working against MongoDB Atlas |
| Expo mobile app — 6 tabs + Admin Panel behind a drawer | working, bundles clean |

## Run

```bash
# data pipeline + engine (all under backend/)
py -3 backend/etl/build.py        # rebuild backend/data/normalized/*.json from D:\Gail  (~3 min)
py -3 backend/etl/mzo_export.py   # refresh the acceptance-test expectations
node backend/engine/validate.ts   # check the engine reproduces the MZO workbook
node backend/engine/demo.ts B52A003 PUNE 120 credit_ifc    # a full comparison

# API
cd backend/api && npm install && npm run seed   # load a round into MONGODB_URI (Atlas)
cd backend/api && npm run start:dev             # API on :3000, docs at /api/docs

# app
cd frontend && npm install && npx expo start    # scan the QR with Expo Go
```

## Running the app

The mobile app finds the API automatically: it derives the dev machine's LAN
address from the Expo dev server it was loaded from, so a phone on the same
Wi-Fi reaches `http://<your-lan-ip>:3000/api` without configuration. Set
`EXPO_PUBLIC_API_URL` to point at staging or production instead.

There is no sign-in screen. The app holds a single administrator account and
authenticates with it silently on launch, so it opens straight into Compare.
That account is `jainam@gmail.com` / `passABC@123`, created by `npm run seed`
(override with `ADMIN_PASSWORD` on the API, and `EXPO_PUBLIC_ADMIN_EMAIL` /
`EXPO_PUBLIC_ADMIN_PASSWORD` in the app). **The credentials ship inside the
bundle — change them, and keep the API off any network you do not control.**

Swipe from the left edge, or tap the ☰ button, for the drawer: **Pricing** (the
tabs) and **Admin Panel** (producers, locations, grades, discount terms, price
book and price circulars). The drawer footer holds the **Dark mode** switch.

## Data provenance

Every figure in the app comes from the 14 circulars and workbooks the ETL
consumes; nothing is entered by hand. The dataset is reproducible — re-running
`backend/etl/build.py` against those documents regenerates
`backend/data/normalized/*.json` byte-for-byte.

Verified against the 01-Aug-2026 round:

| Check | Result |
|---|---|
| GAIL ex-works price cells re-parsed from the PDF | 16,377 / 16,377 exact |
| IOCL Annexure I-A (delivered) rows | match across all 26 grade columns |
| Cross-reference master, 44 grades | every field and all six equivalence columns match |
| MZO acceptance workbook | 88 of 124 reproduced, every deviation attributed |

The cross-reference carries 44 GAIL grades; GAIL's own price book carries 53
codes. 40 grades are both priced and mapped (a full comparison), 13 are priced
with no published equivalence, and 4 are mapped but absent from the price book.
The catalog labels all three cases rather than hiding any of them.

## Theming

Every colour comes from `frontend/src/constants/colors.ts`, which exports a
`light` and a `dark` `ThemeColors` object over the same semantic keys —
`primary`, `surfaceCard`, `textMuted`, `success`/`warning`/`danger`, and the
per-producer `series` colours used for charts. No screen holds a hex string.

Screens consume it two ways:

```tsx
const { colors } = useTheme();              // one-off values in JSX
const useStyles = makeStyles((c) => ({ ... }));  // stylesheets
function Screen() { const styles = useStyles(); }
```

`makeStyles` builds one stylesheet per scheme and caches it, so a theme flip
repaints without rebuilding styles on every render. `StyleSheet.create` copies
its values, which is why a module-level stylesheet can never follow a theme —
that is the whole reason this indirection exists.

The mode is `system` (follow the device), `light`, or `dark`, stored under
`gcpe.themeMode` in AsyncStorage and restored on launch.

## Acceptance test result

Against the 124 ex-works rows of the MZO zonal workbook:

| | rows | |
|---|---|---|
| match | 88 | reproduced to the rupee from the PDFs alone |
| cheaper | 4 | engine found a lower published RIL plant price |
| stale | 19 | workbook figure appears in **no** Aug-2026 circular |
| mismatch | 10 | 4 more Pune rows (same cause); 6 OPaL rows at ±30 (insurance) |
| unresolved | 3 | HMEL publishes no Goa freight this town resolves to |

Nothing is unexplained. Two findings came out of it:

**The workbook's Pune blocks are stale.** All six producers are overstated-low
by ₹6,000–12,000/MT there, and those basic prices exist nowhere in any August
circular. The drip-pipe block in the same sheet reconciles exactly — so it is
those blocks, not the sheet. The Pune price-correction ask that reached the
pricing team rests on them.

**OPaL's ₹30/MT insurance is treated inconsistently** — folded into freight at
Jalgaon, left out at Bhiwandi, Daman, Silvassa, Aurangabad and Goa. The engine
reports it as its own field rather than picking a side.

## The two rules that keep answers honest

**1. Freight is added only to ex-works sellers.**

| Producer | Basis | Freight |
|---|---|---|
| RIL, IOCL | delivered | already inside the published price |
| GAIL, HMEL, OPaL, HPL | ex-works | added from that producer's freight circular |

Adding freight to RIL or IOCL would flatter GAIL by roughly the freight amount.
The MZO workbook gets this right even though it labels every column "ExW".

**2. A missing input is reported, never zero-filled.**

Every quote carries a `gaps` list. A quote with no freight figure is
*incomplete*, not cheap. An unresolved location returns "no published price"
rather than a number from the wrong town — a wrong gap sends a wrong price
correction up the chain.

## What the sources do and don't support

**HMEL prices differently from everyone else.** One ex-Bathinda basic price per
grade, minus a per-location adjustment. Verified: B0155D basic 141,700 less
Bhiwandi 3,930 = 137,770, exactly as the MZO workbook has it.

**Location coverage is capped by the sources, not the code.** Competitors publish
69–90 pricing zones; GAIL sells to 313 locations. Only HPL publishes which
districts fall in which zone (its Annexure V, 71 points / 527 districts). IOCL's
equivalent annexure is referenced by its own circular but is **not in the file**.
So each location resolves through one of four tiers, and the tier travels with
the quote:

| Tier | Meaning |
|---|---|
| `exact` | the producer names this place |
| `alias` | a known naming difference, cross-checked against the MZO workbook |
| `published_map` | the producer's own district map says so (HPL only) |
| `evidence` | the workbook used a price that appears at exactly one zone in that producer's circular — so that is the zone. This is what reaches Bhiwandi → HPL's Maharashtra_Mumbai, which no name matching finds, since HPL lists the district (Thane) not the town |
| `inferred_via_hpl` | HPL's district map places the town in a cluster whose hub this producer prices — an inference, flagged in the UI |
| `unresolved` | no price shown |

**GAIL's own discount scheme is not in the pack.** Every competitor circular
publishes CD, EPI/EPD and quantity slabs. For GAIL only the ₹1,000 cash discount
is knowable, read off the MZO workbook — and it is ₹100/MT *below* every
competitor's ₹1,100 before freight is even considered. GAIL's quantity slabs are
recorded as `UNKNOWN`; the engine says so rather than assuming parity. Fill
`DISCOUNTS["GAIL"]` in `backend/etl/build.py` when the circular is available.

**The cross-reference is from Dec 2023.** It is the join Modules 1, 2 and 7 all
depend on, and it predates the Aug 2026 circulars it is being used against. Its
per-row confidence flag is carried through to every quote.

**RIL supplies the same grade from several plants** at different delivered
prices (B56003 into Mumbai: 140,636 ex-Hazira, 140,629 ex-Dahej), and the
cross-reference often lists several interchangeable grades per competitor. The
engine quotes the cheapest of both — the offer the customer can actually get.
Deemed-export annexures are excluded: ~12,000/MT lower, different customer
category, not comparable with a domestic sale.

**Module 8 has nothing to compare yet.** One price round (1 Aug 2026) and one
freight round (1 Jun 2026). The schema is stamped with `effective_date` so
rounds accumulate.

## Why extraction is coordinate-based

`pdftotext -layout` silently shifts right-hand column groups by one row in the
GAIL, RIL, IOCL, Haldia and OPaL tables — verified in all five. RIL's Annexure IA
gives Agartala the row below it; GAIL's page 21 gives Guwahati Gurgaon's prices.
Nothing errors and no cell is blank, so a wrong price is indistinguishable from a
right one. `backend/etl/pdfrows.py` reads word coordinates instead.

## Layout

Two top-level folders: everything the phone runs is in `frontend/`, everything
else is in `backend/`.

```
frontend/                 Expo React Native app (expo-router)
  src/
    app/                  routes only — the drawer, the tab group, the admin stack
      _layout.tsx         drawer: Pricing | Admin Panel, and the silent session gate
      (tabs)/             Compare, Deal, Grades, Freight, Circulars, Corrections
      admin/              Admin Panel — producers, locations, grades, discounts,
                          price book, price circulars
    components/           shared presentational pieces (ui, inputs, dataGrid,
                          masterData, DrawerContent)
    services/             api.ts (the only place the app talks to the backend), download.ts
    context/              auth.tsx — the silent single-account session
                          theme.tsx — light/dark state, persisted; useTheme + makeStyles
    constants/colors.ts   the one place a colour is chosen
    context/catalog.tsx   the picker data, loaded once per session
    theme.ts              spacing, radii, and shared formatting

backend/
  api/                    NestJS — all pricing logic lives here
    src/
      core/               the netback ladder the API serves
      modules/catalog/    every selectable value + dependent availability
      database/           schemas, seed, verify-counts
      modules/            auth, grades, locations, pricing, deals, freight,
                          circulars, corrections, master-data, exports
  engine/                 standalone TS engine + the MZO acceptance test
    types.ts              Quote / Comparison, with basis and gap tracking
    pricing.ts            the netback ladder
    validate.ts           MZO acceptance test
  etl/                    the data pipeline
    pdfrows.py            coordinate-based PDF table reading
    locations.py          resolving one town across six naming schemes
    build.py              runs everything → backend/data/normalized/*.json
    mzo_export.py         acceptance-test expectations
    extractors/           one module per producer
  data/normalized/        generated — safe to delete and rebuild
```
