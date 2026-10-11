import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  // Relative asset paths so the built app also loads from file:// inside Electron.
  base: './',
  plugins: [react()],
})
