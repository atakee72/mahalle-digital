# Incident: recurring MongoServerSelectionError blips

**Window:** 2026-07-19 → 2026-07-27 (region fix deployed) · watch closed 2026-07-30 · **low-rate regression 2026-08-02** → staged driver tuning (see bottom)

## Symptom
Sporadic prod errors (Sentry MAHALLE-PROD-2, 34 events; MAHALLE-PROD-4, 4 events):
- `MongoServerSelectionError: Server selection timed out after 5000 ms`
- `MongoNetworkTimeoutError: Socket 'secureConnect' timed out`

Plus slow SSR and one air-logger cron failure (2026-07-27) inside the same window.

## Root cause
Vercel functions ran in the default region `iad1` (Washington DC) while the Atlas cluster lives in Frankfurt. Every DB roundtrip crossed the Atlantic; on function freeze/thaw the driver's topology rediscovery blew the deliberately trimmed `serverSelectionTimeoutMS: 5000`.

Diagnosis key: `x-vercel-id` response header reads `edge::function-region` — it showed `fra1::iad1`.

## Fix
`"regions": ["fra1"]` in `vercel.json` (commit `87fa494e`) — co-locate functions with the cluster.

Verify after any config change:
```bash
curl -sI https://<prod-domain>/api/kiez-stats | grep x-vercel-id   # must show fra1::fra1
```

## Verification (2026-07-28 → 2026-07-30)
- Zero new events on PROD-2/PROD-4 since deploy; last events predate the fix.
- Air logger probed the DB every 30 min throughout — all clean.
- Both Sentry issues resolved 2026-07-28; regressions auto-reopen + alert.

## Regression (2026-08-02/03) → staged driver tuning

Both Sentry issues auto-reopened: 3 events over two days (vs ~5/day pre-region-fix — a different, much smaller problem). Region pin verified intact (`fra1::fra1`), so these are **within-region cold-start blips**: topology rediscovery occasionally needs >5s even next to the cluster.

**Step 1 (applied 2026-08-03, `be6db7fc`):** `serverSelectionTimeoutMS: 5000 → 10000` in `src/lib/mongodb.ts`. Trade-off accepted: +5s worst-case hang on a genuine outage, in exchange for cold-start rediscovery becoming a slow success instead of a user-facing error.

**Step 2 (held back, one variable at a time):** `maxIdleTimeMS: 60000` — apply ONLY if network-flavored timeouts persist after step 1. Note it cannot fix PROD-4-style events: those show elapsed times far beyond the configured budget (e.g. 341s vs 30s), which is a Vercel freeze/thaw timer artifact, not a stale socket.
> ⛔ **RETIRED 2026-08-11 — do NOT apply step 2.** The recurrence turned out to be a
> cold-start `client.connect()`, where no pool exists for `maxIdleTimeMS` to act on.
> Jump to "Reopened 2026-08-11" at the end of this file before acting on anything below.

**Known quirk (deliberate):** the Sentry `beforeSend` transient filter's pattern `/MongoNetworkError.*timed out/i` never matches the actually-thrown subclass `MongoNetworkTimeoutError`. This gap is what let PROD-4 through as a useful tripwire — leave it unfixed.

**Watch:** PROD-2/PROD-4 left unresolved as tripwires; evaluate ~2026-08-10 (air logger probes the DB every 30 min as a free canary).

## Closure (2026-08-06)

Step 1 held: 2.5+ quiet days after the last event (2026-08-03 20:53 UTC) with the air logger probing every 30 min. Both issues **resolved** in Sentry. The manual watch is retired — alert rule 725977 now includes a Regression condition (added 2026-08-05), so any recurrence emails immediately. Playbook if that email arrives: freeze-artifact events (elapsed ≫ configured budget) don't count; a real network-flavored timeout → apply step 2 (`maxIdleTimeMS: 60000`). ⛔ **This last clause was WRONG — see "Reopened 2026-08-11" below; step 2 is retired.** The correct first move on any recurrence is to read the stack frames: `MongoClient._connect` = cold-start connect (no pool), anything under `ConnectionPool` = an actual pooled-socket problem.

## Reopened 2026-08-11 → root cause was NOT a stale socket (step 2 retired)

Both tripwires reopened. PROD-2: 38 events total, ~1/night around 01:00–01:40 UTC,
`userCount: 0`. PROD-4: 6 events, last 2026-08-09 — `617832ms` elapsed against a
`30000ms` budget, i.e. the usual freeze artifact; ignored per the playbook.

The playbook said "real network-flavored timeout → apply step 2
(`maxIdleTimeMS: 60000`)". **That would have been the wrong fix**, and the stack
trace is why:

```
MongoServerSelectionError: Server selection timed out after 10000 ms
mechanism: auto.node.onunhandledrejection (unhandled)
  at Topology.selectServer → Topology._connect → Topology.connect
  → topologyConnect → MongoClient._connect
```

That is the **initial `client.connect()`** at module eval — a cold start with no
pool yet — not a reused idle pooled connection. `maxIdleTimeMS` governs when idle
*pooled* connections are discarded, so it has nothing to act on here. Step 2 is
retired; don't apply it on this signal.

Two real defects the trace exposed, both fixed in `de90bc37`
(`src/lib/mongodb.ts`):

1. **Unhandled rejection.** Nothing awaits the module-scope connect promise at
   eval time, so a cold-start failure surfaced as a context-free
   `unhandledRejection` instead of a request error. Now the promise carries a
   `p.catch(() => {})` marker: awaiters still get the rejection (captured by the
   middleware *with* request context), while a failure nobody was waiting on
   stays quiet.
2. **Poisoned container.** The rejected promise stayed cached on
   `globalThis._mongoClientPromise`, so every later request on that container
   awaited the same rejection until recycling. The catch now uncaches the failed
   attempt (and closes the dead client) so the next caller connects fresh;
   `connectDB()` reads the global lazily to pick that up.

Verified against an unreachable host before shipping: 0 unhandled rejections,
cache cleared, awaiter still receives `MongoServerSelectionError`, second call
builds a fresh client.

**Caveat:** consumers that await the *default export* (the Auth.js adapter in
`auth.config.ts`) hold one fixed promise and don't get the retry. Prefer
`connectDB()` in new code.

## Reopened 2026-09-18 … 09-20 — one event after every deploy → retry the first connect

PROD-2 reopened three times in two days (09-18 00:07, 09-20 13:09 local, plus the
08-24 event): each time ONE event, in the minute after a production deploy, on
`GET /api/profile/tour` (an open tab polling the tour state hits the freshly
started instance first). Stack frames read first, per the playbook above — all
three: `MongoClient.connect → topologyConnect → Topology.connect →
Topology.selectServer`, `handled=true`, with request context. So the 08-11 fixes
work as designed (no unhandled rejection, no poisoned container); what remained
is that the ONE request waiting on a slow cold-start connect fails after 10 s,
while the next request connects instantly with a fresh client.

**Fix (`src/lib/mongoRetry.ts`, used by `connectDB()`):** retry that first
connect once, for connection-class errors only. Not a Sentry filter — an outage
has the same signature and must stay loud; it now surfaces after two attempts
(~20 s) instead of one (~10 s). Verified with the real driver against an
unreachable host → dev database (attempts 2, failed client closed, ping ok, 0
unhandled rejections) and against a permanent outage (error after 2 attempts).

**If PROD-2 reopens again:** read the frames. `MongoClient.connect` twice in a
row means both attempts failed — that is no longer a cold-start blip; check
Atlas status and the region pin before anything else.

