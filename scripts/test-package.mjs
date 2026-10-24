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
import { createDatabaseTasks } from '@mindqa/db-commons/cypress';
const cjs = createRequire(import.meta.url)('@mindqa/db-commons');
const cypressCjs = createRequire(import.meta.url)('@mindqa/db-commons/cypress');
assert.equal(cjs.DatabaseService, DatabaseService);
assert.equal(typeof cypressCjs.createDatabaseTasks, 'function');
assert(DatabaseService.connection('erp') instanceof DatabaseClient);
assert.equal(typeof createDatabaseTasks()['db:select'], 'function');
await assert.rejects(DatabaseService.select(''), TypeError);
await DatabaseService.closePools();`;
  await writeFile(join(consumer, 'smoke.mjs'), esm);
  run(process.execPath, ['smoke.mjs'], consumer);
  await writeFile(
    join(consumer, 'smoke.cjs'),
    "const { DatabaseService } = require('@mindqa/db-commons');\nconst { createDatabaseTasks } = require('@mindqa/db-commons/cypress');\nconst assert = require('node:assert/strict');\nassert.equal(typeof DatabaseService.select, 'function');\nassert.equal(typeof createDatabaseTasks, 'function');\n",
  );
  run(process.execPath, ['smoke.cjs'], consumer);
  const ts = `import { DatabaseService } from '@mindqa/db-commons';
import { createDatabaseTasks, type CypressDatabaseParameter } from '@mindqa/db-commons/cypress';
declare global {
  namespace Cypress {
    interface Loggable { log: boolean }
    interface Timeoutable { timeout: number }
    interface Chainable<Subject = any> {
      task<S = unknown>(event: string, arg?: any, options?: Partial<Loggable & Timeoutable>): Chainable<S>;
    }
  }
}
interface Cliente { id: number; nome: string }
const rows: Promise<Cliente[]> = DatabaseService.select<Cliente>('SELECT * FROM clientes WHERE id = ?', 1);
void rows;
const cypressParameter: CypressDatabaseParameter = '2026-10-19T00:00:00.000Z';
void cypressParameter;
type CypressTask = (value: any) => any;
interface CypressTasks { [key: string]: CypressTask }
declare function registerCypressTasks(event: 'task', tasks: CypressTasks): void;
const databaseTasks = createDatabaseTasks();
registerCypressTasks('task', databaseTasks);
databaseTasks['db:select']({ sql: 'SELECT ?', params: [1], connection: 'qa', database: 'test' });
declare const cy: Cypress.Chainable;
const selectedRows: Cypress.Chainable<import('@mindqa/db-commons').DatabaseRow[]> = cy.task('db:select', {
  sql: 'SELECT ?',
  params: [1],
  connection: 'qa',
  database: 'test',
}, {
  log: false,
  timeout: 30_000,
});
const affectedRows: Cypress.Chainable<number> = cy.task('db:execute', {
  sql: 'DELETE FROM clientes WHERE id = ?',
  params: [1],
});
const typedSelectedRows: Cypress.Chainable<Cliente[]> = cy.task<Cliente[]>('db:select', {
  sql: 'SELECT id, nome FROM clientes',
});
const closedPools: Cypress.Chainable<null> = cy.task('db:closePools');
void selectedRows;
void affectedRows;
void typedSelectedRows;
void closedPools;
// @ts-expect-error Date deve ser serializada antes de atravessar cy.task
databaseTasks['db:select']({ sql: 'SELECT ?', params: [new Date()] });
// @ts-expect-error bigint deve ser serializado antes de atravessar cy.task
databaseTasks['db:select']({ sql: 'SELECT ?', params: [1n] });
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
