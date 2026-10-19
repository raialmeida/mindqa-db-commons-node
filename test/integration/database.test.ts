import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { DatabaseService, DatabaseError } from '@mindqa/db-commons';
import type { DatabaseType } from '@mindqa/db-commons';

const requested = process.env.IT_DATABASE;
const engines: DatabaseType[] = ['postgresql', 'sqlserver', 'mysql', 'oracle'];
if (requested && !engines.includes(requested as DatabaseType))
  throw new Error('IT_DATABASE inválido.');

for (const engine of engines.filter(
  (engine) => !requested || requested === engine,
)) {
  for (const pooled of [false, true]) {
    describe(`${engine}, pool=${pooled}`, () => {
      const table = `mindqa_${randomBytes(6).toString('hex')}`;
      const client = DatabaseService.connection(engine);
      const poolKey = `${engine.toUpperCase()}_POOL_ENABLED`;
      const previousPool = process.env[poolKey];
      const previousDefault = process.env.DB_DEFAULT_CONNECTION;
      const quote = (name: string) =>
        engine === 'mysql'
          ? `\`${name}\``
          : engine === 'sqlserver'
            ? `[${name}]`
            : `"${name}"`;
      const id = quote('id');
      const name = quote('name');
      const note = quote('note');
      const binary = quote('binary_value');
      const date = quote('created_at');
      const dataType =
        engine === 'oracle'
          ? 'RAW(64)'
          : engine === 'sqlserver'
            ? 'VARBINARY(64)'
            : engine === 'postgresql'
              ? 'BYTEA'
              : 'VARBINARY(64)';
      const dateType =
        engine === 'sqlserver'
          ? 'DATETIME2'
          : engine === 'mysql'
            ? 'DATETIME(3)'
            : 'TIMESTAMP';
      let created = false;

      beforeAll(async () => {
        process.env[poolKey] = String(pooled);
        process.env.DB_DEFAULT_CONNECTION = engine;
        DatabaseService.clearConfigurationCache();
        await client.execute(
          `CREATE TABLE ${table} (${id} INTEGER PRIMARY KEY, ${name} VARCHAR(100), ${note} VARCHAR(100), ${binary} ${dataType}, ${date} ${dateType})`,
        );
        created = true;
      });

      afterAll(async () => {
        try {
          if (created) await client.execute(`DROP TABLE ${table}`);
        } finally {
          await DatabaseService.closePools();
          if (previousPool === undefined) delete process.env[poolKey];
          else process.env[poolKey] = previousPool;
          if (previousDefault === undefined)
            delete process.env.DB_DEFAULT_CONNECTION;
          else process.env.DB_DEFAULT_CONNECTION = previousDefault;
          DatabaseService.clearConfigurationCache();
        }
      });

      it('creates, selects, updates and removes with bound values and auto-commit', async () => {
        const unsafe = "O'Brien ?'); DROP TABLE clients; --";
        expect(
          await client.execute(
            `INSERT INTO ${table} (${id}, ${name}, ${note}, ${binary}, ${date}) VALUES (?, ?, ?, ?, ?)`,
            1,
            unsafe,
            null,
            Buffer.from([0, 1, 255]),
            new Date('2025-01-02T12:30:00Z'),
          ),
        ).toBe(1);
        interface Row {
          id: number;
          name: string;
          note: string | null;
          binary_value: Buffer;
          created_at: Date;
        }
        const rows = await DatabaseService.select<Row>(
          `SELECT * FROM ${table} WHERE ${id} = ?`,
          1,
        );
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({
          id: 1,
          name: unsafe,
          note: null,
          binary_value: Buffer.from([0, 1, 255]),
        });
        expect(rows[0]?.created_at).toBeInstanceOf(Date);
        expect(
          await client.execute(
            `UPDATE ${table} SET ${name} = ? WHERE ${id} = ?`,
            'Cliente QA',
            1,
          ),
        ).toBe(1);
        expect(
          await client.execute(`DELETE FROM ${table} WHERE ${id} = ?`, 1),
        ).toBe(1);
        expect(
          await client.select(`SELECT * FROM ${table} WHERE ${id} = ?`, 1),
        ).toEqual([]);
      });

      it('supports concurrent calls and exact affected row counts', async () => {
        const counts = await Promise.all(
          Array.from({ length: 8 }, (_, index) =>
            client.execute(
              `INSERT INTO ${table} (${id}, ${name}) VALUES (?, ?)`,
              index + 10,
              `Cliente ${index}`,
            ),
          ),
        );
        expect(counts).toEqual(Array(8).fill(1));
        expect(await client.select(`SELECT * FROM ${table}`)).toHaveLength(8);
        expect(
          await client.execute(`DELETE FROM ${table} WHERE ${id} >= ?`, 10),
        ).toBe(8);
      });

      it('ignores placeholder characters in SQL literals and comments', async () => {
        const suffix = engine === 'oracle' ? ' FROM dual' : '';
        const rows = await client.select(
          `SELECT '?' AS ${quote('literal')}, ? AS ${quote('bound')} /* ? */${suffix}`,
          'value',
        );
        expect(rows).toEqual([{ literal: '?', bound: 'value' }]);
      });

      it('returns driver cause without SQL values in the library error message and recovers', async () => {
        await expect(
          client.select(
            `SELECT * FROM mindqa_missing_${randomBytes(4).toString('hex')}`,
          ),
        ).rejects.toBeInstanceOf(DatabaseError);
        await expect(client.select(`SELECT * FROM ${table}`)).resolves.toEqual(
          [],
        );
      });

      it('overrides a configured database without mutating the original client', async () => {
        const nameKey = `${engine.toUpperCase()}_NAME`;
        const original = process.env[nameKey];
        const target = engine === 'oracle' ? 'FREEPDB1' : 'mindqa';
        process.env[nameKey] = 'mindqa_does_not_exist';
        try {
          expect(
            await client.database(target).select(`SELECT * FROM ${table}`),
          ).toEqual([]);
          await expect(
            client.select(`SELECT * FROM ${table}`),
          ).rejects.toBeInstanceOf(DatabaseError);
        } finally {
          if (original === undefined) delete process.env[nameKey];
          else process.env[nameKey] = original;
        }
      });

      it('applies query timeout and allows subsequent operations', async () => {
        const key = `${engine.toUpperCase()}_QUERY_TIMEOUT_SECONDS`;
        const previous = process.env[key];
        process.env[key] = '1';
        const sql =
          engine === 'postgresql'
            ? 'SELECT pg_sleep(4)'
            : engine === 'mysql'
              ? 'SELECT SLEEP(4)'
              : engine === 'oracle'
                ? 'BEGIN DBMS_SESSION.SLEEP(4); END;'
                : "WAITFOR DELAY '00:00:04'; SELECT 1 AS value";
        try {
          const codes = {
            postgresql: '57014',
            mysql: 'PROTOCOL_SEQUENCE_TIMEOUT',
            sqlserver: 'ETIMEOUT',
            oracle: 'NJS-123',
          };
          await expect(client.select(sql)).rejects.toMatchObject({
            name: 'DatabaseError',
            cause: { code: codes[engine] },
          });
        } finally {
          if (previous === undefined) delete process.env[key];
          else process.env[key] = previous;
        }
        expect(await client.select(`SELECT * FROM ${table}`)).toEqual([]);
      });
    });
  }
}
