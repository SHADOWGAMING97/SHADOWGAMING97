import { defineConfig } from 'vite';
import { resolve } from 'node:path';
export default defineConfig({
  root: resolve(process.cwd(), 'src/www'),
  build: {
    outDir: resolve(process.cwd(), 'dist'),
    emptyOutDir: true,
  },
});
