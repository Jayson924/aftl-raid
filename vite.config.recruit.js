import { defineConfig } from 'vite'
import { resolve } from 'path'
import { existsSync, renameSync } from 'fs'
import { join } from 'path'

export default defineConfig({
  appType: 'spa',
  build: {
    outDir: 'dist-recruit',
    rollupOptions: {
      input: resolve(import.meta.dirname, 'recruit.html'),
    },
  },
  plugins: [{
    name: 'rename-recruit-html',
    closeBundle() {
      const src = join('dist-recruit', 'recruit.html');
      const dest = join('dist-recruit', 'index.html');
      if (existsSync(src)) {
        renameSync(src, dest);
      }
    }
  }],
})
