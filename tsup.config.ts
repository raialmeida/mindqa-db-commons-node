import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['cjs'],
  target: 'node22',
  platform: 'node',
  dts: true,
  clean: true,
  sourcemap: true,
});
