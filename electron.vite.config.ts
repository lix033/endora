import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    resolve: { alias: { '@shared': resolve('src/shared') } }
  },
  preload: {
    resolve: { alias: { '@shared': resolve('src/shared') } },
    build: {
      rollupOptions: {
        input: { index: resolve('src/preload/index.ts'), sandbox: resolve('src/preload/sandbox.ts') },
        // Un preload sandboxé ne peut pas être un module ES.
        output: { format: 'cjs', entryFileNames: '[name].cjs' }
      }
    }
  },
  renderer: {
    resolve: { alias: { '@shared': resolve('src/shared') } },
    plugins: [react()],
    build: {
      rollupOptions: {
        // Deux pages : l'interface et la page d'exécution isolée des scripts.
        input: { index: resolve('src/renderer/index.html'), sandbox: resolve('src/renderer/sandbox.html') }
      }
    }
  }
})
