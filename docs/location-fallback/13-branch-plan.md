# Implementation branches and coding sequence

**As executed (2026-09-25):** all five branches exist locally, none pushed. Each stacks on the previous branch's tip rather than on a merged `main` (no merges happened; review was the gate). PR4 was based on PR3, not PR2 as planned below, so the release is one linear line:

```
origin/main c88cb792 (ex-depot release)
└ 7c797c29 PR0 · 1ab4e9cd, 5d7b54b9 PR1 · 11773562, feb7d376 PR2 · 48881377 PR3 · PR4
```

Twice a parallel session's version-bump commit landed on these branches (it shared this working directory); both were rebased out. The original plan follows.

---

## Starting point

| | |
|---|---|
| Local `main` (current tip) | `c88cb792` — 7 commits ahead of `origin/main`, the unreleased ex-depot work (not pushed, not deployed) |
| `origin/main` (last pushed) | `34bfd560` |
| Uncommitted in the working tree on top of `c88cb792` | The HPL Annexure V table-cell fix (decision 0009) — coded and verified, not yet committed |

Every branch below stacks on `main` in order. None of this pushes to `origin` — that stays a separate, later decision (it is what "cannot be released ahead of the depot work" in `06-implementation-plan.md` §12 refers to).

## Branch sequence

```
main (c88cb792, local, unpushed)
  │
  ├─ location-fallback/pr0-hpl-annexure-fix
  │     commits the already-verified decision 0009 working-tree changes as-is
  │     (haldia.py, build.py, break_test.py, 5 regenerated data files)
  │
  ├─ location-fallback/pr1-etl-reference-data          (base: pr0, after merge)
  │     Bilaspur guard + state table; fallback reference tables, builder, ETL merge
  │
  ├─ location-fallback/pr2-backend-engine-loaders       (base: pr1, after merge)
  │     core/*.ts, schema, seed, migration-lib, both loaders, equivalence-verify
  │
  ├─ location-fallback/pr3-app-ui                       (base: pr2, after merge)
  │     services/api.ts, theme.ts, (tabs)/index.tsx
  │
  └─ location-fallback/pr4-release-verification-docs    (base: pr2, after merge — parallel to pr3)
        verify-release stages; ai/ docs, decision, changelog, maps
```

PR3 and PR4 are siblings off PR2 — either can merge first; neither depends on the other.

## Commands to run, once approved (not run yet)

```bash
cd D:/Gail2/gailcpe

# PR0 — commit the already-approved HPL fix as its own branch
git checkout -b location-fallback/pr0-hpl-annexure-fix
git add backend/etl/extractors/haldia.py backend/etl/build.py backend/etl/break_test.py \
        backend/data/normalized/price_index.json backend/data/normalized/prices.json \
        backend/data/normalized/freight.json backend/data/normalized/locations.json \
        backend/data/normalized/build_report.json
git commit -m "ETL: read HPL Annexure V from table cells; reconcile against the price book (decision 0009)"

# after PR0 review and merge to main:
git checkout main && git merge --ff-only location-fallback/pr0-hpl-annexure-fix
git checkout -b location-fallback/pr1-etl-reference-data
# ... PR1 work ...

# after PR1 review and merge to main:
git checkout main && git merge --ff-only location-fallback/pr1-etl-reference-data
git checkout -b location-fallback/pr2-backend-engine-loaders
# ... PR2 work ...

# after PR2 review and merge to main:
git checkout main && git merge --ff-only location-fallback/pr2-backend-engine-loaders
git checkout -b location-fallback/pr3-app-ui        # from main, which now has pr0-pr2
git checkout main
git checkout -b location-fallback/pr4-release-verification-docs
```

Each `git merge --ff-only` is a placeholder for however review actually happens (GitHub PR merge, since there's no remote for this yet, or a fast-forward once one exists) — the point is each branch stacks on the previous one's merged result, not on a stale copy of `main`.

## Coding sequence (matches `10-implementation-work-breakdown.md`)

| Order | Branch | Depends on merge of | Can start once |
|---|---|---|---|
| 1 | `pr0-hpl-annexure-fix` | — | now (already coded, just needs committing) |
| 2 | `pr1-etl-reference-data` | PR0 | PR0 merged |
| 3 | `pr2-backend-engine-loaders` | PR1 | PR1 merged |
| 4a | `pr3-app-ui` | PR2 | PR2 merged |
| 4b | `pr4-release-verification-docs` | PR2 | PR2 merged, parallel with 4a |

No deployment step (`12-deployment-checklist.md`) begins until all five branches above are merged to `main`.

## What happens to `origin` / pushing

Unrelated to this branch plan and not decided here: `main` is 7 commits ahead of `origin/main` from the ex-depot work already, and this initiative adds 5 more on top locally. Whether/when to push and in what grouping is the depot release's own open question (`06-implementation-plan.md` §12's precondition) — this plan assumes those commits are pushed and deployed first, or in the same push as this work, per that precondition, but does not decide it.
