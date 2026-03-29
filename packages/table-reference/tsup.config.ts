import { defineConfig } from 'tsup'

export default defineConfig({
  clean: true,
  entry: ['src/index.tsx'],
  format: ['esm'],
  outDir: 'dist',
  sourcemap: true,
  splitting: false,
  target: 'es2022',
  treeshake: 'recommended',
})
