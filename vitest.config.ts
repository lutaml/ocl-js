import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

export default defineConfig({
  resolve: {
    alias: {
      '@metanorma/ocl': resolve(__dirname, 'src/index.ts'),
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
  },
})
