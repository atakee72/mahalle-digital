# Postmortem: cold starts were the CPU bill (2026-10-13)

**Symptom.** Vercel mailed „75 % of the free 4 h Fluid Active CPU used" on day 11 of a billing cycle. Traffic was ~2 000 requests a day — nowhere near enough to explain it, and the per-route usage view is Pro-only.

**How it was found.** Measured instead of guessed. A wrapper around the production bundle (`scratchpad/coldstart/cpu-server.mjs`) exposed `process.cpuUsage()`; a Playwright probe logged in and measured CPU per route; `esmcount.mjs` counted the modules the first request loads; a `--cpu-prof` aggregated by package.

**Root cause.** A WARM request cost 5–40 ms of CPU. The FIRST request on a fresh instance cost 1.2–2.9 s: about 1 000 small files resolved and compiled — `@sentry/*` + `@opentelemetry/*` ≈ 650, `date-fns` 304 through its barrel import, `jose` + `@auth/core` ≈ 110. A few hundred cold starts a day × ~1.5 s was exactly the 5–8 CPU-minutes the chart showed.

**Fix.** `vite.ssr.noExternal` for those packages in `astro.config.mjs`, so they are bundled into the server chunks and the first request loads ~60 files. Landing cold start 2.9 s → 0.43 s, `/api/kiez-stats` 1.2 s → 0.38 s, login 1.4 s → 0.38 s; warm requests about halved. `mongodb`/`bson`, `bcrypt` and Sentry's ESM hook `import-in-the-middle` stay external (native/optional deps).

**What could have gone wrong, and how it was checked.** Bundling Sentry can break event delivery silently. Proven against a local sink (`sentry-sink.mjs`) with a build whose DSN pointed at `127.0.0.1` — note that `SENTRY_DSN` and `MONGODB_URI` are inlined at build time by Vite, so such a test needs a rebuild, not an env override.

**Verification.** Usage page 2026-10-19: 4–10 min/day before, ~2 min/day after, about 1 h of the 4 h per month. Closed.

**Process change.** Before adding a package that ships hundreds of files, re-measure the cold start. The usage page offers only rolling windows („Last 7 Days" shows the pace; „Last 30 Days" summed the pre-fix days and looked alarming). Full notes: root `CLAUDE.md` → „Cold starts are the CPU bill".
