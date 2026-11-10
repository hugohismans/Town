import { defineConfig } from 'vitest/config';

// Base relatif : le site marche tel quel sous https://<user>.github.io/<repo>/
export default defineConfig({
  base: './',
  build: { target: 'es2022', sourcemap: false },
  test: { environment: 'node', include: ['tests/**/*.test.ts'], testTimeout: 120000 },
});
