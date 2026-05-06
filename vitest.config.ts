import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    // Only run vitest specs in src/ — the legacy tests/security/*.test.mjs
    // suite uses Node's built-in test runner (`npm run test:security`).
    include: ['src/**/*.test.{ts,tsx}'],
    environment: 'node',
  },
})
