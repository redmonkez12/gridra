import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react-swc'
import path from 'node:path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@gridra/core': path.resolve(
        __dirname,
        '../../packages/core/src/index.ts',
      ),
      '@gridra/react': path.resolve(
        __dirname,
        '../../packages/react/src/index.ts',
      ),
      '@gridra/table-reference': path.resolve(
        __dirname,
        '../../packages/table-reference/src/index.tsx',
      ),
    },
  },
})
