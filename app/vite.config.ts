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
      // Offline contract:
      //   1. App shell (HTML/JS/CSS/SVG) + ALL BSB chapter JSON + alignment JSON
      //      → precached on install. After one online visit the app works
      //        completely offline for reading the BSB.
      //   2. The 1.2 GB of narration MP3s → runtime-cached only when actually
      //        played (CacheFirst). The <audio> element uses preload="none"
      //        so we never download an MP3 the user didn't ask to hear.
      //   3. Other translations (KJV/ASV/WEB/...) come from bible-api.com over
      //        the network — they're the only thing that requires connectivity.
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
        // Explicitly EXCLUDE the audio library (~1.2 GB of MP3s); those are
        // runtime-cached on demand by the CacheFirst rule below.
        globPatterns: ['**/*.{js,css,html,svg,json,webmanifest}'],
        globIgnores: ['**/audio/**'],
        // Some chapter JSON / alignment files (Psalm 119) approach 1 MB; bump
        // the per-file cap so the build doesn't silently drop them.
        maximumFileSizeToCacheInBytes: 12 * 1024 * 1024,
        // SPA fallback: requests that *look* like navigations get index.html
        // out of the precache, which makes deep links (e.g. /speedbible/john/3)
        // work fully offline. The denylist keeps the fallback from clobbering
        // genuine asset URLs.
        navigateFallback: (process.env.VITE_BASE ?? '/speedbible/') + 'index.html',
        navigateFallbackDenylist: [/\/audio\//, /\/bible-static\//, /\.[a-z0-9]+$/i],
        runtimeCaching: [
          {
            // BSB chapter narration. CacheFirst → once a chapter has been
            // listened to, it's available offline. Capped at ~250 chapters to
            // avoid filling the user's device unboundedly.
            //
            // The custom requestWillFetch plugin strips the audio element's
            // `Range:` header before going to the network so we cache a clean
            // 200 with the FULL body. The subsequent RangeRequestsPlugin slices
            // that cached body to satisfy partial requests on replay/seeking.
            // Without this, GitHub Pages returns a 206 on the first play, we
            // cache the 206, and any later range request that doesn't exactly
            // match `bytes=0-` returns the wrong bytes.
            urlPattern: ({ url }) => url.pathname.includes('/audio/') && url.pathname.endsWith('.mp3'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'speedbible-audio',
              expiration: { maxEntries: 250, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
              rangeRequests: true,
              plugins: [
                {
                  // Strip the audio element's `Range:` header before hitting
                  // the network so the cache stores a complete 200 response.
                  // RangeRequestsPlugin (enabled via `rangeRequests: true`
                  // above) then slices that cached body to satisfy any later
                  // partial requests when the user seeks.
                  requestWillFetch: async ({ request }) => {
                    if (!request.headers.has('range')) return request;
                    const headers = new Headers(request.headers);
                    headers.delete('range');
                    return new Request(request.url, {
                      method: request.method,
                      headers,
                      mode: request.mode === 'navigate' ? 'cors' : request.mode,
                      credentials: request.credentials,
                      redirect: request.redirect,
                      referrer: request.referrer,
                      integrity: request.integrity,
                    });
                  },
                },
              ],
            },
          },
          {
            // Google Fonts stylesheet + WOFF2 files. Stale-while-revalidate so
            // the app still has typography offline after the first online load.
            urlPattern: /^https:\/\/fonts\.(googleapis|gstatic)\.com\/.*/,
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'speedbible-fonts' },
          },
        ],
      },
    }),
  ],
})
