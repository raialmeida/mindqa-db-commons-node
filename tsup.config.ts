import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/cypress.ts'],
  format: ['cjs'],
  target: 'node22',
  platform: 'node',
  external: ['@mindqa/db-commons'],
  dts: true,
  clean: true,
  sourcemap: true,
});
