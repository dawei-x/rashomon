import { svelte } from '@sveltejs/vite-plugin-svelte'
import { defineConfig } from 'vitest/config'

// https://vite.dev/config/
export default defineConfig({
  // Relative base so the built site works at a domain root or any subdirectory.
  base: './',
  plugins: [svelte()],
  // Runes in .svelte.ts modules need Svelte's browser build when run under vitest.
  resolve: process.env.VITEST ? { conditions: ['browser'] } : undefined,
  test: {
    include: ['tests/**/*.test.ts'],
  },
})
