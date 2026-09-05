# Release checklist — price round deployment

For deploying a new price round to production. Written against the 2026-09-01
round; the counts change each month, the procedure does not.

Work top to bottom. Every step that can fail, fails before anything is written.

---

## 0. Before you start

- [ ] The round's circulars are on disk and you know the path to each.
- [ ] A manifest exists for the round in `backend/etl/rounds/<round>.json`.
      Copy the previous month's and change the eight price-circular paths.
      Leave freight, cross-reference and MZO out unless those changed too.
- [ ] You know the round's effective date as the circulars print it.
- [ ] `backend/api/.env` points at the database you intend to write to.

> The seeder deletes before it inserts. Read that line again against the URI in
> `.env` before continuing.

---

## 1. Required environment

| Variable | When | Value |
| --- | --- | --- |
| `GCPE_PRICE_ROUND` | always | the round's effective date, `YYYY-MM-DD` |
| `GCPE_SOURCES` | always | path to the round's manifest |
| `GCPE_SOURCE` | rarely | source directory, if not `D:/Gail` |
| `GCPE_ALLOW_SHRINK` | only with a verified withdrawal | `1` |
| `GCPE_RECORD_SHAPE` | once the round is accepted | `1` |
| `GCPE_ALLOW_RAGGED` | only with a verified incomplete circular | `1` |
| `GCPE_ALLOW_DRIFT` | only with verified large price movement | `1` |
| `GCPE_DATA` | rehearsals only | staged directory for the seeder to read |

The four `ALLOW` variables are acknowledgements, not switches. Each says a
person looked at a specific number and accepted it. None belongs in a script.

---

## 2. Build the dataset

```bash
GCPE_PRICE_ROUND=2026-09-01 \
GCPE_SOURCES=backend/etl/rounds/2026-09-01.json \
python3 backend/etl/build.py
```

**Expect this to stop.** The build refuses twice on a normal month, and both
refusals are the point.

| Gate | What it means | What to do |
| --- | --- | --- |
| Round | a circular does not state the date you gave | You have the wrong round or the wrong documents. Do not override without checking both. |
| Rectangle | a producer's book is not zones × grades | Either the circular changed shape and the reader has not kept up, or this round genuinely does not price every grade everywhere. Find out which. |
| Shrink | a producer lost whole grades or zones | A withdrawal is normal; a reader that lost a page looks identical. Confirm against the circular, then `GCPE_ALLOW_SHRINK=1`. |
| Drift | over 0.5% of a book moved more than 10% | Read `drift_report.json` and the largest movements it lists. |

For 2026-09-01 the expected stop is:

```
SHRUNK   RIL    grades: 286 -> 256  (30 fewer)
```

RIL withdrew 32 grades and added 2. Verified: none of the 32 appears in the
September circular as a whole token. Re-run with `GCPE_ALLOW_SHRINK=1`.

Then confirm the build printed six complete matrices:

```
complete GAIL      313x53   16589 cells
complete IOCL       69x40    2760 cells
complete RIL       75x256   19200 cells
complete HMEL      80x114    9120 cells
complete HPL        71x60    4260 cells
complete OPaL       90x39    3510 cells
```

- [ ] `round <date> confirmed against all six circulars`
- [ ] six `complete` lines, no `RAGGED`
- [ ] any `SHRUNK` line matches a withdrawal you have checked
- [ ] `drift_report.json` shows no producer over the threshold
- [ ] eight files written

### The first deployment will show drift the next one will not

The drift check compares against whatever is already in
`backend/data/normalized`. On the first deployment of the corrected extractors
that is the *uncorrected* previous round, so HMEL's own correction registers as
movement — 133 cells over 5%, one over 10%, a 0.03% share, inside the limit.
That is the correction being noticed, not a fault. Later rounds are quiet.

---

## 3. Record the new baseline

Once the round is accepted, move the shrink baseline forward:

```bash
GCPE_PRICE_ROUND=2026-09-01 \
GCPE_SOURCES=backend/etl/rounds/2026-09-01.json \
GCPE_ALLOW_SHRINK=1 GCPE_RECORD_SHAPE=1 \
python3 backend/etl/build.py
```

- [ ] `recorded expected_shape.json for round <date>`
- [ ] `backend/etl/expected_shape.json` committed

Skip this and every later build keeps tripping the shrink gate against the old
round, which trains people to pass `GCPE_ALLOW_SHRINK` without reading it.

---

## 4. Compile, seed, verify

```bash
cd backend/api
npm run build
npm run seed
npm run verify
```

Expected counts for 2026-09-01:

> `npm run verify` prints **collection totals**, and `priceEntries` accumulates
> across rounds — the seeder replaces only the round it is loading and leaves
> earlier ones alone, so historical comparisons stay reproducible. After
> seeding September onto a database that already held August, the collection
> reads 107,369: 51,930 for 2026-08-01 and 55,439 for 2026-09-01. Check the
> round, not the total. Everything else in this table is replaced outright and
> so is an exact count.

| Collection | Count |
| --- | --- |
| `priceEntries` | **55,439 for the round** (collection total is cumulative) |
| `grades` | 589 |
| `locations` | 313 |
| `gradeMappings` | 44 |
| `freightEntries` | 1,962 |
| `priceCirculars` | 6 |
| `freightCirculars` | 4 |
| `producers` | 6 |
| `discountSchemes` | 6 |
| `roles` | 1 |
| `users` | 1 |

- [ ] `npm run build` exits 0
- [ ] seed reports `priceEntries 55,439` — that figure is the round
- [ ] `npm run verify` matches the table above, allowing for the cumulative total
- [ ] the round's own count is right, per producer:

```js
db.priceEntries.aggregate([
  { $match: { effectiveDate: ISODate("2026-09-01") } },
  { $group: { _id: "$producer", n: { $sum: 1 } } }, { $sort: { _id: 1 } }
])
// GAIL 16589  HMEL 9120  HPL 4260  IOCL 2760  OPaL 3510  RIL 19200
```

- [ ] earlier rounds are still present and unchanged

`priceEntries` is the number to check first. It is the sum of the six matrices
the build printed: 313×53 + 69×40 + 75×256 + 80×114 + 71×60 + 90×39. If it
disagrees, the seed and the build are looking at different data.

---

## 5. Start and check the API

```bash
cd backend/api
npm run start:prod
```

- [ ] `Nest application successfully started`
- [ ] `GCPE API listening on port <port>, base path /api`
- [ ] no `ERROR`, no exception, no migration in the startup log

The API seeds on boot only when `MONGODB_URI` is unset, which is the ephemeral
development path. With a URI present it starts read-only against what is
already there.

```bash
curl -s localhost:3000/api/health
```

- [ ] `200` with `{"status":"ok","database":"up"}`

Then one known comparison, which needs a token:

```bash
TOKEN=$(curl -s -X POST localhost:3000/api/auth/login \
  -H 'content-type: application/json' \
  -d '{"email":"<admin>","password":"<password>"}' | jq -r .accessToken)

curl -s -X POST localhost:3000/api/pricing/compare \
  -H "content-type: application/json" -H "authorization: Bearer $TOKEN" \
  -d '{"grade":"B52A003A","location":"DELHI","quantityMt":120,"paymentMode":"cash"}'
```

- [ ] `201`, six quotes, one per producer
- [ ] every quote carries a numeric `basic` and `invoiceLanded`

For 2026-09-01 this returns leader IOCL, with GAIL at 1,40,690 basic and
1,41,087.55 landed.

---

## 6. Rehearsing without touching production

Point the build somewhere else and seed an isolated database:

```bash
GCPE_PRICE_ROUND=2026-09-01 \
GCPE_SOURCES=backend/etl/rounds/2026-09-01.json \
GCPE_OUT=D:/Gail2/staged/sept \
GCPE_PREVIOUS=backend/data/normalized/price_index.json \
python3 backend/etl/build.py

cd backend/api
MONGODB_URI=<...>/gailcpe_rehearsal GCPE_DATA=D:/Gail2/staged/sept npm run seed
MONGODB_URI=<...>/gailcpe_rehearsal npm run verify
```

`GCPE_OUT` sends the build to staging. `GCPE_PREVIOUS` keeps the drift check
comparing against the round in service — without it the staging directory is
empty, drift has nothing to compare, and the gate silently does nothing.

Afterwards, drop the rehearsal database and check it is gone by listing
collections rather than trusting the call. `build.py` writing to
`backend/data/normalized` also leaves `drift_report.json`, which is a new file
rather than a modified one — `git checkout` will not remove it.

---

## 7. Verification tooling

Read-only. None of these writes to a database or to `data/normalized`.

From `backend/api`, with `-r tsconfig-paths/register`:

```bash
npx ts-node -r tsconfig-paths/register src/tools/completeness.ts D:/Gail2/staged/sept
npx ts-node -r tsconfig-paths/register src/tools/september-retest.ts D:/Gail2/staged/sept
npx ts-node -r tsconfig-paths/register src/tools/stage-consistency.ts D:/Gail2/staged/sept
MONGODB_URI=<isolated> npx ts-node -r tsconfig-paths/register src/tools/e2e-pdf-to-api.ts
```

From `backend/etl`:

```bash
py -3 verify_against_pdf.py D:/Gail2/staged/sept
py -3 breakage_suite.py
```

| Tool | Answers |
| --- | --- |
| `completeness` | is every producer's book a rectangle |
| `september-retest` | are the historical defects still closed |
| `stage-consistency` | does a value survive extractor → index → seeder document |
| `e2e-pdf-to-api` | does it survive all the way to an HTTP response |
| `verify_against_pdf` | do sampled cells match the page, read by a third library |
| `breakage_suite` | do the gates still stop a deliberately broken build |

`e2e-pdf-to-api` refuses to run against a URI ending in the production database
name, and needs the round already seeded into the isolated one.

`breakage_suite.py` edits extractors and reverts them; it verifies the tree is
byte-identical afterwards. Do not run it against a checkout with uncommitted
work in `backend/etl/extractors`.

---

## What this checklist does not cover

Reconciling the built index against the independent TypeScript readers is the
only check that catches a mispairing between two similarly-priced neighbouring
columns — drift cannot see one, because the values move less than a normal
month does. It is not in the steps above because it is slow, and it is recorded
here so that its absence is a decision rather than an oversight.
