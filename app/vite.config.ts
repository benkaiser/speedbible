import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// Base set for GitHub Pages project site at /speedbible/.
// Override with VITE_BASE=/ for local previews if needed.
export default defineConfig({
  base: process.env.VITE_BASE ?? '/speedbible/',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'icons.svg'],
      manifest: {
        name: 'SpeedBible',
        short_name: 'SpeedBible',
        description:
          'Spritz-style speed reader for the Bible. RSVP at 300–1000+ WPM with synced narration.',
        theme_color: '#0d1117',
        background_color: '#0d1117',
        display: 'standalone',
        scope: process.env.VITE_BASE ?? '/speedbible/',
        start_url: process.env.VITE_BASE ?? '/speedbible/',
        icons: [
          { src: 'favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' },
        ],
      },
      workbox: {
        // Precache the app shell + bundled scripture text + alignment JSONs.
        // EXCLUDE the 1.1 GB audio library; runtime-cache it on demand instead.
        globPatterns: ['**/*.{js,css,html,svg,json}'],
        globIgnores: ['**/audio/**'],
        // Some chapter JSON / alignment files can exceed the 2 MiB default.
        maximumFileSizeToCacheInBytes: 12 * 1024 * 1024,
        navigateFallback: (process.env.VITE_BASE ?? '/speedbible/') + 'index.html',
        // Don't intercept asset URLs as SPA navigations.
        navigateFallbackDenylist: [/\/audio\//, /\/bible-static\//, /\.[a-z0-9]+$/i],
        runtimeCaching: [
          {
            // BSB chapter narration. CacheFirst — once a chapter has been
            // listened to, it's available offline. Cap to ~250 chapters
            // (~250 MB) to avoid filling the user's device.
            urlPattern: ({ url }) => url.pathname.includes('/audio/') && url.pathname.endsWith('.mp3'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'speedbible-audio',
              expiration: { maxEntries: 250, maxAgeSeconds: 60 * 60 * 24 * 365 },
              rangeRequests: true,
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // Google Fonts stylesheet + WOFF2 files.
            urlPattern: /^https:\/\/fonts\.(googleapis|gstatic)\.com\/.*/,
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'speedbible-fonts' },
          },
        ],
      },
    }),
  ],
})
