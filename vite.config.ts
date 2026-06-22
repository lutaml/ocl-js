import { defineConfig } from 'vite'
import dts from 'vite-plugin-dts'
import { resolve } from 'node:path'

export default defineConfig({
  plugins: [
    dts({
      entryRoot: 'src',
      outDir: 'dist',
      include: ['src/**/*.ts'],
    }),
  ],
  build: {
    lib: {
      entry: {
        ocl: resolve(__dirname, 'src/index.ts'),
      },
    },
    rollupOptions: {
      output: [
        {
          format: 'es',
          entryFileNames: '[name].js',
        },
        {
          format: 'cjs',
          entryFileNames: '[name].cjs',
        },
      ],
    },
  },
})
