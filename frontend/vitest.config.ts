import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// vitest.config.ts is intentionally separate from vite.config.ts. Vitest reads
// vitest.config.ts first if present, so the dev server proxy in vite.config.ts
// does not affect jsdom-based tests.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/dist-electron/**',
      'tests/e2e/**',
      'electron/**',
    ],
    css: false,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/**/*.{test,spec}.{ts,tsx}',
        'src/test/**',
        'src/main.tsx',
        'src/vite-env.d.ts',
      ],
    },
  },
})
