import pg from 'pg';
import type {
  ConnectionSettings,
  DatabaseParameter,
  DatabaseRow,
} from '../types.js';
import { acquireWithin, usingResource } from '../internal/resources.js';
import type { DatabaseDriver } from './driver.js';

export function createPostgresqlDriver(
  settings: ConnectionSettings,
): DatabaseDriver {
  const config: pg.ClientConfig = {
    ...structuredClone(settings.driverOptions),
    host: settings.host,
    port: settings.port,
    user: settings.user,
    password: settings.password,
    database: settings.database,
    connectionTimeoutMillis: settings.loginTimeoutMs,
    statement_timeout: settings.queryTimeoutMs,
  };
  const pool = settings.poolEnabled
    ? new pg.Pool({ ...config, max: settings.poolMaxSize })
    : undefined;
  // pg já remove conexões ociosas com erro; o listener evita um erro não tratado no processo.
  pool?.on('error', () => undefined);

  async function query(
    sql: string,
    params: readonly DatabaseParameter[],
  ): Promise<pg.QueryResult<DatabaseRow>> {
    if (pool) {
      const client = await acquireWithin(
        pool.connect(),
        settings.poolConnectionTimeoutMs,
        (late) => late.release(true),
      );
      return usingResource(
        client,
        (connection) => connection.query(sql, [...params]),
        (connection, failed) => connection.release(failed),
      );
    }
    const client = new pg.Client(config);
    return usingResource(
      client,
      async (connection) => {
        await connection.connect();
        return connection.query(sql, [...params]);
      },
      (connection) => connection.end(),
    );
  }
  return {
    async select(sql, params) {
      return (await query(sql, params)).rows;
    },
    async execute(sql, params) {
      return (await query(sql, params)).rowCount ?? 0;
    },
    async close() {
      await pool?.end();
    },
  };
}
