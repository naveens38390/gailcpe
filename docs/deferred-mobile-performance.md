# Deferred: mobile startup performance

Three changes identified during the APK v2 performance investigation
(29 Aug 2026) and deliberately **not** implemented. None is the cause of the
reported slowness — that was Render sleeping, with the keep-alive workflow
firing every 3–11 hours instead of every 10 minutes.

Fix the sleeping backend first and re-measure. These are refinements to how a
cold start *feels*, and if the service stops sleeping they may not justify a
release on their own. All three are client-side, so they need an APK build —
batch them together rather than shipping separately.

## 1. Persist the access token

`services/api.ts` holds the token in memory only:

> *"The token lives in memory for the life of the process. There is nothing to
> persist and nothing to clear: a relaunch simply signs in again."*

Measured against production, that costs **1,834 ms of a 3,397 ms path to usable
data — 54%** — on every launch:

```
/auth/login                    0 → 1834 ms    (blocks everything)
/catalog                    1835 → 3397 ms  ┐ already concurrent
/notifications/unread-count 1835 → 2622 ms  ┘
```

The two data calls are already parallel; there is no reordering left to win.
The saving is removing the round trip, not moving it.

`@react-native-async-storage/async-storage` is already a dependency and already
used by `context/theme.tsx`, so no new package is needed. The token expires in
12 hours and the failure path already exists: a stale token 401s, `request()`
re-authenticates and replays, costing one extra round trip rather than a broken
session.

Expected effect: warm launches roughly **3.4 s → 1.6 s** to data.

**Judgement call, not a pure win.** It puts a bearer token in device storage.
Given the app already ships administrator credentials inside the bundle, that is
not a materially new exposure — but it is a deliberate change, not an
optimisation to slip in unnoticed.

## 2. Cut the per-attempt timeout from 25 s to 8–10 s

`ATTEMPT_TIMEOUT_MS` is 25 s with backoff `[500, 2000, 5000]`. Measured against a
stub that accepts the connection and never answers:

```
attempt 1  t+0.0s
attempt 2  t+26.9s
attempt 3  t+55.9s
attempt 4  t+87.9s
```

Four attempts spanning 88 s, plus a final 25 s abort — **~113 s before the app
reports anything is wrong**. The gaps run ~2 s over the design because each
attempt re-establishes the connection.

Shortening the per-attempt limit keeps the retries and still outlasts a 43 s
cold start, while dropping the worst case to roughly 40 s and reporting a
genuinely unreachable service in seconds rather than minutes.

Do not remove the retries — they are what makes a cold start survivable on
Android, where the platform socket timeout fires around 10 s.

## 3. Say what is happening during a cold start

The launch screen reads "Opening the price book" for the entire wait, whether
that is one second or forty-three. Naming the wake-up once a few seconds have
passed turns an apparent hang into an explained delay.

Cheapest of the three, costs no time at all, and addresses the actual complaint
— which was about perception, not throughput.

## Ruled out, with measurements

Recorded so none of these is re-investigated:

| Suspected cause | Measurement |
| --- | --- |
| Larger JS bundle | 3,999,324 → 4,025,984 bytes (+0.67%) |
| Larger APK | 105,947,648 → 106,007,472 bytes (+0.06%) |
| Change History screen | `GET /timeline` — 737 ms, 1.3 KB |
| Circular Intelligence screens | `GET /circulars` — 508 ms, 2.8 KB (fastest endpoint) |
| Catalog preloading | identical to v1 — no provider changed between builds |
| Excessive startup requests | 3, unchanged from v1, 37 KB total |
| Sequential startup requests | already parallel — both start at 1835 ms |
| Production API latency | every endpoint < 1.5 s and < 40 KB warm |
| Expo build configuration | same 88 native libraries, same 1,293 APK entries |
