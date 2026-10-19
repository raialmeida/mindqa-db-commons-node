import { copyFile, writeFile } from 'node:fs/promises';

// Ambos os formatos usam a mesma implementação para compartilhar pools e cache.
await writeFile(
  'dist/index.js',
  "export { DatabaseService, DatabaseClient, DatabaseError, DatabaseConfigurationError } from './index.cjs';\n",
);
await copyFile('dist/index.d.cts', 'dist/index.d.ts');
