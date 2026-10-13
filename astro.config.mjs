import { defineConfig } from 'astro/config';
import sentry from '@sentry/astro';
import react from '@astrojs/react';
import svelte from '@astrojs/svelte';
import tailwind from '@astrojs/tailwind';
import vercel from '@astrojs/vercel';
import auth from 'auth-astro';
import mdx from '@astrojs/mdx';

// https://astro.build/config
export default defineConfig({
  site: 'https://mahalle.digital',

  output: 'server', // Server mode for Vercel serverless functions

  // The cross-site form check lives in src/middleware.ts (same rule, one exempt path for the
  // Kiez-Brief one-click unsubscribe — Gmail POSTs it as a form without an Origin). Never
  // switch this back on without removing that exemption's need: Astro's check runs BEFORE the
  // middleware and would 403 the endpoint again.
  security: { checkOrigin: false },

  adapter: vercel({
    webAnalytics: {
      enabled: true
    }
  }),

  integrations: [
    sentry({
      // Request-error capture lives in src/middleware.ts (explicit
      // captureException + flush before the serverless freeze — see the
      // comment there). The SDK's own request handler would sit OUTSIDE
      // user middleware where nothing can flush after its capture, and
      // its async delivery is exactly what the freeze eats.
      autoInstrumentation: { requestHandler: false },
      // NO dsn / SDK options here — initialization lives exclusively in
      // sentry.client.config.ts + sentry.server.config.ts (Decision 9).
      // process.env, NOT import.meta.env: astro.config.mjs runs before
      // Vite env injection, where import.meta.env is not populated —
      // this is the repo's one sanctioned process.env site.
      // Missing token must not fail the build — uploads turn on when it lands.
      ...(process.env.SENTRY_AUTH_TOKEN
        ? {
            sourceMapsUploadOptions: {
              org: process.env.SENTRY_ORG,
              project: process.env.SENTRY_PROJECT,
              authToken: process.env.SENTRY_AUTH_TOKEN,
            },
          }
        : {}),
    }),
    auth(),
    react({
      experimentalReactChildren: true
    }),
    svelte(),
    tailwind({
      applyBaseStyles: false, // We'll use our own base styles
    }),
    mdx()
  ],

  vite: {
    optimizeDeps: {
      exclude: ['mongodb', 'bcrypt', '@mongodb-js/saslprep', 'node-gyp-build']
    },
    ssr: {
      external: [
        'mongodb',
        'bcrypt',
        '@mongodb-js/saslprep',
        'node-gyp-build',
        'kerberos',
        'snappy',
        'socks',
        'mongodb-client-encryption',
        'bson-ext',
        'win32-x64-msvc',
        'darwin-x64',
        'linux-x64-gnu'
      ],
      // Cold-start budget (2026-10-13): every request on a fresh Fluid instance paid 1.2–2.9 s
      // of CPU before this line, almost all of it Node resolving and compiling ~1000 small
      // files — @sentry/* + @opentelemetry/* (~650), date-fns (304, the barrel import loads
      // every function), jose + @auth/core (~110). Bundling them into the server chunks makes
      // the first request load ~60 files: landing 2.9 s → 0.43 s, /api/kiez-stats 1.2 s → 0.38 s,
      // login page 1.4 s → 0.38 s (measured on the node-adapter build; Sentry delivery re-verified
      // against a local sink). The Hobby plan's 4 CPU-hours/month were 76 % used by day 11 with
      // ~2 000 requests a day — the bill was cold starts, not traffic. mongodb/bcrypt and the
      // native optional deps stay external (above); `import-in-the-middle` must stay external
      // (Sentry's ESM hook). Re-measure with scratchpad/coldstart/ before adding a heavy package.
      noExternal: ['date-fns', /^@sentry\//, /^@opentelemetry\//, 'jose', '@auth/core', '@panva/hkdf', 'preact']
    },
    resolve: {
      alias: {
        '@': new URL('./src', import.meta.url).pathname
      }
    },
    build: {
      rollupOptions: {
        external: [
          'mongodb',
          'bcrypt',
          '@mongodb-js/saslprep',
          'node-gyp-build'
        ]
      }
    }
  },

  server: {
    port: 3000,
    host: true
  },

  build: {
    inlineStylesheets: 'auto'
  }
});