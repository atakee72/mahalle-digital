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
        'jsonwebtoken',
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
      ]
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