import { defineConfig } from 'vite'
import { resolve } from 'path'
import { existsSync, renameSync } from 'fs'
import { join } from 'path'

export default defineConfig({
  appType: 'spa',
  build: {
    outDir: process.env.RECRUIT_BUILD ? 'dist' : 'dist-recruit',
    rollupOptions: {
      input: resolve(import.meta.dirname, 'recruit.html'),
    },
  },
  plugins: [{
    name: 'rename-recruit-html',
    closeBundle() {
      const outDir = process.env.RECRUIT_BUILD ? 'dist' : 'dist-recruit';
      const src = join(outDir, 'recruit.html');
      const dest = join(outDir, 'index.html');
      if (existsSync(src)) {
        renameSync(src, dest);
      }
    }
  }],
})
