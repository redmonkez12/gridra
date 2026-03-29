import path from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@gridra/core': path.resolve(__dirname, './packages/core/src/index.ts'),
      '@gridra/react': path.resolve(__dirname, './packages/react/src/index.ts'),
      '@gridra/table-reference': path.resolve(
        __dirname,
        './packages/table-reference/src/index.tsx',
      ),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    coverage: {
      reporter: ['text', 'html'],
    },
  },
})
