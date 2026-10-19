import mssql from 'mssql';
import type { ConnectionSettings, DatabaseParameter } from '../types.js';
import type { DatabaseDriver } from './driver.js';

export async function createSqlserverDriver(
  settings: ConnectionSettings,
): Promise<DatabaseDriver> {
  const pool = new mssql.ConnectionPool({
    server: settings.host,
    port: settings.port,
    user: settings.user,
    password: settings.password,
    database: settings.database,
    ...(settings.loginTimeoutMs > 0
      ? { connectionTimeout: settings.loginTimeoutMs }
      : {}),
    requestTimeout: settings.queryTimeoutMs,
    pool: {
      min: 0,
      max: settings.poolEnabled ? settings.poolMaxSize : 1,
      acquireTimeoutMillis: settings.poolConnectionTimeoutMs,
    },
    options: {
      ...structuredClone(settings.driverOptions),
      encrypt: settings.encrypt,
      trustServerCertificate: settings.trustServerCertificate,
    },
  });
  pool.on('error', () => undefined);
  try {
    await pool.connect();
  } catch (error) {
    await pool.close().catch(() => undefined);
    throw error;
  }

  async function query(sql: string, params: readonly DatabaseParameter[]) {
    const request = pool.request();
    params.forEach((value, index) => {
      const name = `mindqa_p${index + 1}`;
      if (typeof value === 'bigint')
        request.input(name, mssql.BigInt, value.toString());
      else if (typeof value === 'number')
        request.input(
          name,
          Number.isInteger(value)
            ? value >= -2147483648 && value <= 2147483647
              ? mssql.Int
              : mssql.BigInt
            : mssql.Float,
          value,
        );
      else if (typeof value === 'boolean')
        request.input(name, mssql.Bit, value);
      else if (value instanceof Date)
        request.input(name, mssql.DateTime2, value);
      else if (Buffer.isBuffer(value))
        request.input(name, mssql.VarBinary(mssql.MAX), value);
      else request.input(name, mssql.NVarChar(mssql.MAX), value);
    });
    return request.query(sql);
  }
  return {
    async select(sql, params) {
      return (await query(sql, params)).recordset ?? [];
    },
    async execute(sql, params) {
      return (await query(sql, params)).rowsAffected.reduce(
        (sum, count) => sum + count,
        0,
      );
    },
    async close() {
      await pool.close();
    },
  };
}
