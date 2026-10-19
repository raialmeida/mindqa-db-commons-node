import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile, mkdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = process.cwd();
const temp = await mkdtemp(join(tmpdir(), 'mindqa-package-'));
const npmCli = process.env.npm_execpath;
assert(npmCli, 'Execute este script com npm run test:package.');
const run = (command, args, cwd = temp) =>
  execFileSync(command, args, {
    cwd,
    stdio: 'pipe',
    env: process.env,
  }).toString();
try {
  const [packed] = JSON.parse(
    run(
      process.execPath,
      [
        npmCli,
        'pack',
        '--json',
        '--ignore-scripts',
        '--pack-destination',
        temp,
      ],
      root,
    ),
  );
  assert.equal(packed.name, '@mindqa/db-commons');
  assert.equal(
    packed.version,
    JSON.parse(await readFile(join(root, 'package.json'), 'utf8')).version,
  );
  assert(
    packed.files.every(
      ({ path }) =>
        path.startsWith('dist/') ||
        ['package.json', 'README.md', 'LICENSE'].includes(path),
    ),
  );
  const consumer = join(temp, 'consumer');
  await mkdir(consumer);
  await writeFile(
    join(consumer, 'package.json'),
    JSON.stringify({ private: true, type: 'module' }),
  );
  run(
    process.execPath,
    [
      npmCli,
      'install',
      '--prefer-offline',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      join(temp, packed.filename),
    ],
    consumer,
  );
  const esm = `import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { DatabaseService, DatabaseClient } from '@mindqa/db-commons';
const cjs = createRequire(import.meta.url)('@mindqa/db-commons');
assert.equal(cjs.DatabaseService, DatabaseService);
assert(DatabaseService.connection('erp') instanceof DatabaseClient);
await assert.rejects(DatabaseService.select(''), TypeError);
await DatabaseService.closePools();`;
  await writeFile(join(consumer, 'smoke.mjs'), esm);
  run(process.execPath, ['smoke.mjs'], consumer);
  await writeFile(
    join(consumer, 'smoke.cjs'),
    "const { DatabaseService } = require('@mindqa/db-commons');\nrequire('node:assert/strict').equal(typeof DatabaseService.select, 'function');\n",
  );
  run(process.execPath, ['smoke.cjs'], consumer);
  const ts = `import { DatabaseService } from '@mindqa/db-commons';
interface Cliente { id: number; nome: string }
const rows: Promise<Cliente[]> = DatabaseService.select<Cliente>('SELECT * FROM clientes WHERE id = ?', 1);
void rows;
// @ts-expect-error objetos não são parâmetros SQL portáveis
DatabaseService.select('SELECT ?', { id: 1 });
// @ts-expect-error undefined não significa SQL NULL
DatabaseService.select('SELECT ?', undefined);
`;
  await writeFile(join(consumer, 'consumer.mts'), ts);
  await writeFile(join(consumer, 'consumer.cts'), ts);
  run(
    process.execPath,
    [
      resolve(root, 'node_modules/typescript/bin/tsc'),
      '--noEmit',
      '--strict',
      '--target',
      'ES2022',
      '--module',
      'NodeNext',
      '--moduleResolution',
      'NodeNext',
      'consumer.mts',
      'consumer.cts',
    ],
    consumer,
  );
  console.log(
    'Pacote validado: instalação do tarball, JavaScript ESM/CommonJS, TypeScript ESM/CommonJS e registro compartilhado.',
  );
} finally {
  await rm(temp, { recursive: true, force: true });
}
