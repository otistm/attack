import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

// NOTE: Do NOT add `define: { 'process.env.GEMINI_API_KEY': ... }` here.
// Vite's `define` performs a compile-time string-replace, which inlines
// the API key literal into any client bundle chunk that references it.
// Any future Gemini integration must run on a server-side process and
// inject the key via runtime env vars only -- never compile-time
// substitution into the browser bundle.
export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify -- file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
    },
  };
});
