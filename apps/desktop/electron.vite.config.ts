import { defineConfig } from 'electron-vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';
import { resolve } from 'node:path';
export default defineConfig({
  main: {
    build: {
      externalizeDeps: { exclude: ['@agripos/shared'] },
      rollupOptions: { input: resolve('electron/main/index.ts') },
    },
  },
  preload: {
    build: {
      rollupOptions: {
        input: resolve('electron/preload/index.ts'),
        output: { format: 'cjs', entryFileNames: 'index.cjs' },
      },
    },
  },
  renderer: {
    root: '.',
    plugins: [react(), tailwind()],
    build: { rollupOptions: { input: resolve('index.html') } },
  },
});
