import mysql from 'mysql2/promise';
import type {
  ConnectionSettings,
  DatabaseParameter,
  DatabaseRow,
} from '../types.js';
import { acquireWithin, usingResource } from '../internal/resources.js';
import type { DatabaseDriver } from './driver.js';

export function createMysqlDriver(
  settings: ConnectionSettings,
): DatabaseDriver {
  const config: mysql.ConnectionOptions = {
    supportBigNumbers: true,
    bigNumberStrings: true,
    ...structuredClone(settings.driverOptions),
    host: settings.host,
    port: settings.port,
    user: settings.user,
    password: settings.password,
    database: settings.database,
    ...(settings.loginTimeoutMs > 0
      ? { connectTimeout: settings.loginTimeoutMs }
      : {}),
    multipleStatements: false,
  };
  const pool = settings.poolEnabled
    ? mysql.createPool({
        ...config,
        connectionLimit: settings.poolMaxSize,
        waitForConnections: true,
      })
    : undefined;

  async function query(sql: string, params: readonly DatabaseParameter[]) {
    const connection = pool
      ? await acquireWithin(
          pool.getConnection(),
          settings.poolConnectionTimeoutMs,
          (late) => late.destroy(),
        )
      : await mysql.createConnection(config);
    return usingResource(
      connection,
      (client) =>
        client.execute(
          { sql, timeout: settings.queryTimeoutMs },
          params.map((value) =>
            typeof value === 'bigint' ? value.toString() : value,
          ),
        ),
      async (client, failed) => {
        // Uma consulta que falhou/expirou nunca continua numa conexão devolvida ao pool.
        if (failed) client.destroy();
        else if (pool) (client as mysql.PoolConnection).release();
        else await client.end();
      },
    );
  }
  return {
    async select(sql, params) {
      const [rows] = await query(sql, params);
      if (!Array.isArray(rows))
        throw new TypeError('select() requer uma consulta que retorne linhas.');
      return rows as DatabaseRow[];
    },
    async execute(sql, params) {
      const [result] = await query(sql, params);
      return 'affectedRows' in result ? result.affectedRows : 0;
    },
    async close() {
      await pool?.end();
    },
  };
}
