import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Base set for GitHub Pages project site at /speedbible/.
// Override with VITE_BASE=/ for local previews if needed.
export default defineConfig({
  base: process.env.VITE_BASE ?? '/speedbible/',
  plugins: [react()],
})
