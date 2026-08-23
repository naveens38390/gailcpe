# GCPE Backend — API, Pricing Engine & Data Pipeline

## 1. Project Overview and Purpose

The backend is the source of truth for the GAIL Competitive Pricing Engine (GCPE). It turns raw price circulars and freight schedules — published as PDFs and workbooks by GAIL and five competing polymer producers — into a single, queryable dataset and a "netback" pricing engine that computes a like-for-like landed cost for every producer at any customer location.

Everything a sales or pricing officer sees in the mobile app — a price comparison, a deal simulation, a freight lookup, a grade match — is calculated here. The app itself contains no pricing logic; it only renders what this API returns. This separation guarantees that a number quoted on a phone in the field is exactly the number the pricing team would get by running the same comparison.

The backend is organised into three parts:

| Part | Location | Responsibility |
|---|---|---|
| Data pipeline (ETL) | `backend/etl` | Parses source circulars/workbooks into a normalized JSON dataset |
| Pricing engine | `backend/engine`, `backend/api/src/core` | The netback calculation shared by every feature |
| API | `backend/api` | NestJS service exposing the engine over HTTP, plus authentication, master-data management, and reporting |

## 2. Key Features and Functionality

- **Price comparison ("netback") engine** — computes a comparable landed cost for GAIL and up to five competitors (RIL, IOCL, HMEL, OPaL, HPL) for a given grade, customer location, quantity and payment terms, correctly handling delivered vs. ex-works pricing bases and freight.
- **Deal Simulator** — given the same inputs, reports where GAIL stands against the cheapest competitor and what a set of price corrections (hold, partial concession, match, undercut) would cost and win, using the same engine as the comparison so the two can never disagree.
- **Grade search and cross-reference** — looks up GAIL grades by GAIL code, competitor code, or end-use application, and returns every producer's equivalent grade along with mapping confidence.
- **Freight intelligence** — every producer's freight rate to a destination, with the destination match tier and any published insurance surcharge.
- **Master data management** — Producers, Locations, Grade Mappings, Discount Terms, and Price Circulars are all managed through an auditable Draft → Review → Approved → Published workflow with full version history, diffs, and rollback (see §9, Admin Panel).
- **Price Corrections** — a lightweight propose/approve flow for one-off adjustments to a single GAIL price, separate from the full master-data workflow.
- **Circular repository** — a browsable, versioned history of every price and freight circular loaded into the system, grouped by effective date ("round").
- **Report generation** — Excel and PDF exports (Price Circular, Freight Circular, Discount Circular, Grade Mapping, Location Master), generated on demand from the currently published data rather than stored as static files.
- **Authentication and audit** — JWT-based sign-in, with every login and every master-data action recorded to an audit trail.
- **API documentation** — a live Swagger/OpenAPI explorer at `/api/docs`.

## 3. Technology Stack

| Layer | Technology |
|---|---|
| API framework | [NestJS](https://nestjs.com/) 11 (TypeScript) |
| Database | MongoDB, via [Mongoose](https://mongoosejs.com/) 8 (MongoDB Atlas in a real deployment; an ephemeral in-memory MongoDB for local development) |
| Authentication | JWT (`@nestjs/jwt`, `passport-jwt`), password hashing with `bcryptjs` |
| Validation | `class-validator` / `class-transformer` via a global `ValidationPipe` |
| API documentation | `@nestjs/swagger` (OpenAPI) |
| Reporting | `exceljs` (Excel workbooks), `pdfkit` (PDF documents) |
| Data pipeline | Python 3, custom coordinate-based PDF parsing |
| Reference engine / acceptance testing | Standalone TypeScript (Node, `ts-node`) |
| Testing | Jest, `mongodb-memory-server` |
| Language | TypeScript throughout the API and engine; Python for the ETL |

## 4. Project Structure

```
backend/
  api/                          NestJS application — the only thing exposed over HTTP
    src/
      main.ts                   Bootstrap: validation, Swagger, seeding, CORS
      app.module.ts              Root module — wires every feature module together
      core/                     The netback engine and shared domain types
        types.ts                 Producer, Quote, Comparison, DealSimulation, etc.
        pricing.ts                The netback ladder (compare())
        deal.ts                   The Deal Simulator (simulate())
        approval-policy.ts        Maker-checker on/off switch
      database/
        schemas/                 Mongoose schemas (catalog, circulars, activity/audit, revisions)
        seed.ts                   Loads backend/data/normalized/*.json into MongoDB
        verify-counts.ts          Sanity-checks record counts after a seed
      modules/
        auth/                    Sign-in, JWT issuing and validation
        catalog/                 Selectable values (producers, grades, locations) for the app's pickers
        pricing/                 Price comparison endpoint
        deals/                   Deal Simulator endpoint
        freight/                 Freight lookup endpoint
        grades/                  Grade search, detail, and grade master-data workflow
        locations/               Location master-data workflow
        producers/               Producer master-data workflow
        discounts/               Discount-terms master-data workflow
        price-circulars/         Price circular drafting/review/publish workflow
        circulars/               Read-only circular repository and round history
        corrections/             Lightweight price-correction propose/approve flow
        master-data/             Shared Draft → Review → Approved → Published engine
        dataset/                 Loads the live/published dataset for the pricing engine
        exports/                 Excel/PDF report generation
  engine/                       Standalone reference implementation of the netback ladder
    types.ts, pricing.ts          Mirrors backend/api/src/core, used for acceptance testing
    validate.ts                   Reproduces the reference MZO workbook to verify the engine
    demo.ts                       Command-line demonstration of one comparison
  etl/                          The data pipeline (Python)
    pdfrows.py                    Coordinate-based PDF table reader
    locations.py                  Resolves one customer location across every producer's naming scheme
    build.py                      Orchestrates the full pipeline into backend/data/normalized/*.json
    mzo_export.py                 Refreshes the acceptance-test expectations
    extractors/                   One extraction module per producer/source (gail.py, ril.py, iocl.py,
                                   hmel.py, opal.py, haldia.py, freight.py, crossref.py, mzo.py)
  data/
    normalized/                   Generated JSON dataset — safe to delete and rebuild from source documents
```

## 5. Setup and Installation

### Prerequisites

- Node.js 18+ and npm
- Python 3.9+ (only required if you need to regenerate the dataset from source circulars)
- A MongoDB Atlas connection string for a persistent deployment (optional for local development — see §6)

### Install

```bash
cd backend/api
npm install
```

No installation step is required for `backend/engine` beyond the API's own `node_modules` if you run it from the same checkout; it is plain TypeScript executed with `ts-node`/`node`.

The ETL (`backend/etl`) is standalone Python with no external package dependencies beyond the standard library and whatever PDF-handling libraries are already vendored in the project — run `python3 backend/etl/build.py` directly.

## 6. Environment / Configuration Requirements

Configuration is read from environment variables (an `.env` file in `backend/api` is loaded automatically). See `backend/api/.env.example`:

| Variable | Required | Purpose |
|---|---|---|
| `MONGODB_URI` | No | MongoDB Atlas connection string. Left empty, the API starts an ephemeral in-memory MongoDB instance and seeds it automatically — convenient for local development and demos, but data does not survive a restart. |
| `JWT_SECRET` | Recommended | Signing key for access tokens. Falls back to a well-known development value if unset — **must** be set before the API is reachable by anyone outside your own machine. |
| `JWT_EXPIRES_IN` | No | Access token lifetime (default `12h`). |
| `ADMIN_PASSWORD` | Recommended | Password for the built-in administrator account created by `npm run seed`. |
| `PORT` | No | HTTP port (default `3000`). |
| `REQUIRE_SEPARATE_APPROVER` | No | Maker-checker enforcement for master-data changes. `false` by default because the deployment currently has a single administrator account; set to `true` once a second account exists so the same person cannot both propose and approve a change. |

**Security note:** the built-in administrator account exists so the mobile app can sign in automatically with no login screen. Its credentials are effectively part of the application configuration — always set `JWT_SECRET` and `ADMIN_PASSWORD` explicitly, and do not expose the API on a network you do not control until you have.

## 7. Running the Project

### Rebuilding the dataset (optional — only needed when source circulars change)

```bash
python3 backend/etl/build.py          # parses the source documents into backend/data/normalized/*.json
python3 backend/etl/mzo_export.py     # refreshes acceptance-test expectations
node backend/engine/validate.ts       # checks the engine reproduces the reference workbook
node backend/engine/demo.ts B52A003 PUNE 120 credit_ifc   # one comparison from the command line
```

### Loading data into MongoDB

```bash
cd backend/api
npm run seed        # loads backend/data/normalized/*.json into MONGODB_URI, or an ephemeral instance
```

Re-running `seed` replaces the round it is loading; earlier rounds already in the database are left alone, so historical comparisons stay reproducible.

### Starting the API

```bash
cd backend/api
npm run start:dev   # watch mode — API on http://localhost:3000/api
# or
npm run start        # single run, no file watching
```

If `MONGODB_URI` is not set, the API seeds an ephemeral database automatically on boot — a fresh `npm run start:dev` with no other setup is enough to get a working backend for local development.

Once running:
- API base URL: `http://localhost:<PORT>/api`
- Interactive API documentation (Swagger UI): `http://localhost:<PORT>/api/docs`

### Verifying the data

```bash
npm run verify   # sanity-checks record counts after a seed
npm run typecheck
npm test
```

## 8. Build / Deployment Instructions

```bash
cd backend/api
npm run build     # compiles TypeScript to dist/ via `nest build`
node dist/main.js # runs the compiled API (or `npm run start` from source)
```

For a real deployment:

1. Provision a MongoDB Atlas cluster and set `MONGODB_URI` to its connection string.
2. Set `JWT_SECRET` to a strong, unique value and `ADMIN_PASSWORD` to a strong password.
3. Set `REQUIRE_SEPARATE_APPROVER=true` once more than one administrator account exists.
4. Run `npm run build`, then run `node dist/main.js` (or the equivalent start command) behind your usual process manager / container orchestration.
5. Run `npm run seed` once, pointed at the target `MONGODB_URI`, to load the initial dataset. Re-run it whenever `backend/data/normalized` is regenerated from a new round of circulars.
6. Point the mobile app's `EXPO_PUBLIC_API_URL` at the deployed API's base URL (see the frontend README).

The API has no built-in HTTPS termination or process manager — put it behind a reverse proxy / load balancer that terminates TLS in any environment reachable from outside a trusted network.

## 9. Admin Panel Details

The Admin Panel is a section of the mobile app, but everything it does is powered by these API modules. It manages the "master data" the pricing engine depends on: **Producers**, **Locations**, **Grade Mappings**, **Discount Terms**, and **Price Circulars** (plus a read-only browse of the live **Price Book** and generated **Reports**).

Each of those entity types shares one workflow, implemented once in `modules/master-data/revision-workflow.ts` and reused by every module:

```
draft → review → approved → published
              \-> rejected
```

- **Draft** — a proposed change is saved but does not affect anything the app shows.
- **Review** — the draft is submitted for a decision.
- **Approved / Rejected** — a reviewer accepts or declines it. By default the same account that drafted a change may also approve it, because the deployment ships with a single administrator; set `REQUIRE_SEPARATE_APPROVER=true` once a second account exists to require that the approver differ from the proposer.
- **Published** — an approved change is written to the live record. The previous published version is marked **superseded**, never deleted, so `history()` is a complete, permanent record of every change, who made it, and why.
- **Rollback** — restores a prior published version as a *new* published revision (not a resurrection of the old document), keeping the audit trail append-only.

Every module also exposes: a list of **pending** revisions awaiting a decision, per-entity **history**, a **diff** between any two published versions, and (for master-data entities) an **impact** view showing recent comparisons or simulations that used that entity.

**Price Circulars** get an additional editing surface on top of the same workflow: create a new draft cloned from the current live price book, bulk-update many selected rows at once, edit a single row, then submit → review → publish exactly like the other modules.

**Price Corrections** are handled separately and more simply: a one-field propose/decide flow for adjusting a single GAIL price, without the full draft/review/version machinery — appropriate for a fast, defensible fix rather than a structural change to master data.

**Reports**, available from the Admin Panel, are generated fresh from currently published data on every request: Discount Circular (GAIL vs. every other producer's latest terms), Grade Mapping, and Location Master, plus per-circular Excel/PDF exports.

Access to the Admin Panel in the mobile app requires the administrator's password, verified against this API's `/auth/login` endpoint — the check is real, not cosmetic, and is not stored on the device.

## 10. Important Dependencies and Integrations

- **MongoDB / MongoDB Atlas** — the system of record for all master data, circulars, comparisons, deal simulations, and audit history.
- **NestJS ecosystem** (`@nestjs/*`) — application framework, dependency injection, guards, validation pipes, Swagger integration.
- **Passport / JWT** — stateless bearer-token authentication; every route is authenticated by default via a global guard, with individual endpoints opened explicitly (`auth/login`).
- **exceljs** and **pdfkit** — generate the Excel and PDF reports on demand; there is no separate reporting service.
- **mongodb-memory-server** — powers the zero-configuration local/demo mode and the test suite; not used in a real deployment.
- **The ETL pipeline** — not a runtime dependency of the API, but the sole source of the dataset the API serves. The API never parses a source circular itself; it only ever reads `backend/data/normalized/*.json` (via `seed`) or the MongoDB collections that were loaded from it.
- **The mobile app** — the only consumer of this API. It holds no pricing logic of its own and expects the API's global prefix (`/api`), authentication scheme, and response shapes exactly as implemented here.

## 11. Data Flow and Architecture Overview

```
Source circulars (PDF / workbook, per producer)
        │  backend/etl/pdfrows.py — coordinate-based table extraction
        │  backend/etl/extractors/*.py — one normalizer per producer/source
        ▼
backend/etl/build.py
        │  assembles the normalized dataset
        ▼
backend/data/normalized/*.json
  (price index, freight book, grade cross-reference, location master, discount terms)
        │  backend/api/src/database/seed.ts  (npm run seed)
        ▼
MongoDB collections
  (Producer, Location, Grade/GradeMapping, PriceCircular/PriceEntry,
   FreightCircular/FreightEntry, DiscountScheme, User, AuditLog, Revisions)
        │  modules/dataset/dataset.service.ts loads the live, published data
        ▼
core/pricing.ts — compare()            core/deal.ts — simulate()
  the shared netback ladder                built on top of compare(), so a
  (basic − cash discount + freight          recommendation can never disagree
   = landed cost − quantity discount        with the comparison shown above it
   = effective net)
        │
        ▼
NestJS modules (pricing, deals, freight, grades, catalog, …)
        │  HTTP, JSON, JWT-authenticated, documented at /api/docs
        ▼
Mobile app (Compare, Deal, Grades, Freight, Circulars, Corrections, Admin Panel)
```

Two rules run through every calculation and are worth understanding before reading any module's code:

1. **Freight is added only to ex-works sellers.** RIL and IOCL publish delivered prices that already include freight; GAIL, HMEL, OPaL and HPL sell ex-works, and their freight is added from that producer's own freight circular. Adding freight to a delivered price would overstate it.
2. **A missing input is reported, never assumed to be zero.** Every `Quote` carries a `gaps` list — a comparison with no freight figure for a producer is *incomplete*, not free. Likewise, a customer location that cannot be confidently matched to a producer's pricing zone is reported as unresolved rather than priced against the wrong zone.

Master data (Producers, Locations, Grades, Discount Terms, Price Circulars) always flows through the Draft → Review → Approved → Published workflow before it can affect a comparison — the pricing engine only ever reads the *published* state.

## 12. Troubleshooting / Common Issues

**API starts but every request returns 401 Unauthorized.**
Every route requires a valid JWT by default. Confirm the client is sending `Authorization: Bearer <token>`, obtained from `POST /auth/login`. If the mobile app is failing to sign in silently, check that `ADMIN_PASSWORD` on the API matches the credentials the app is configured to use.

**"No MONGODB_URI" logged on startup, or data disappears after a restart.**
This is expected in local/demo mode: without `MONGODB_URI` the API starts an ephemeral in-memory MongoDB and seeds it fresh on every boot. Set `MONGODB_URI` to a real MongoDB Atlas connection string for data to persist.

**`npm run seed` fails with a file-not-found error under `data/normalized`.**
The seed script only loads an already-generated dataset; it does not parse circulars itself. Run `python3 backend/etl/build.py` first to (re)generate `backend/data/normalized/*.json`.

**A price or master-data change made in the Admin Panel doesn't show up in Compare/Deal.**
Master-data changes only take effect once **published**. Check the entity's status — a draft, review, or approved-but-not-yet-published revision does not affect the pricing engine. Also confirm it was published to the round (effective date) you are comparing against.

**A revision can't be approved even though it's under review.**
If `REQUIRE_SEPARATE_APPROVER=true`, the account that created the draft cannot also approve it. This is expected once more than one administrator account exists; either sign in as a different account or temporarily set the flag back to `false` if there truly is only one administrator.

**Grade Mapping / Location Master exports come back with stale data.**
Reports are generated from currently *published* data at request time — if a change is still in draft/review/approved status, it will not appear in a report until published.

**Location resolves to "unresolved" or shows an inferred/low-confidence tier.**
This reflects a genuine gap or ambiguity in the source circulars for that producer/location combination, not a bug — the engine deliberately reports uncertainty rather than guessing. Check `backend/etl/locations.py` and the relevant producer extractor if the underlying source data needs correcting, then rebuild the dataset.

**Swagger UI (`/api/docs`) is unreachable.**
Confirm the API actually started (check the log line `GCPE API on http://localhost:<port>/api`) and that you are browsing to `/api/docs`, not `/docs` — the global prefix `api` applies to the Swagger route too.
