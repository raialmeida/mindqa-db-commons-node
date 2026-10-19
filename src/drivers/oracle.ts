import oracledb from 'oracledb';
import type {
  ConnectionSettings,
  DatabaseParameter,
  DatabaseRow,
} from '../types.js';
import { usingResource } from '../internal/resources.js';
import type { DatabaseDriver } from './driver.js';

export async function createOracleDriver(
  settings: ConnectionSettings,
): Promise<DatabaseDriver> {
  const host = settings.host.includes(':')
    ? `[${settings.host}]`
    : settings.host;
  const timeout =
    settings.loginTimeoutMs > 0
      ? `?connect_timeout=${settings.loginTimeoutMs / 1000}&transport_connect_timeout=${settings.loginTimeoutMs / 1000}&retry_count=0`
      : '';
  const config: oracledb.ConnectionAttributes = {
    ...structuredClone(settings.driverOptions),
    user: settings.user,
    password: settings.password,
    connectString: `${host}:${settings.port}/${settings.database}${timeout}`,
  };
  const pool = settings.poolEnabled
    ? await oracledb.createPool({
        ...config,
        poolMin: 0,
        poolMax: settings.poolMaxSize,
        poolIncrement: 1,
        queueTimeout: settings.poolConnectionTimeoutMs,
      })
    : undefined;

  async function query(sql: string, params: readonly DatabaseParameter[]) {
    const connection = await (pool
      ? pool.getConnection()
      : oracledb.getConnection(config));
    return usingResource(
      connection,
      async (client) => {
        client.callTimeout = settings.queryTimeoutMs;
        const binds: oracledb.BindParameters = {};
        params.forEach((value, index) => {
          // NUMBER mantém bigint exato; boolean usa 1/0 para compatibilidade anterior ao Oracle 23.
          binds[`mindqa_p${index + 1}`] =
            typeof value === 'boolean'
              ? Number(value)
              : typeof value === 'bigint'
                ? { val: value.toString(), type: oracledb.STRING }
                : value;
        });
        return client.execute<DatabaseRow>(sql, binds, {
          autoCommit: true,
          outFormat: oracledb.OUT_FORMAT_OBJECT,
          fetchTypeHandler: (metadata) =>
            metadata.dbType === oracledb.DB_TYPE_CLOB ||
            metadata.dbType === oracledb.DB_TYPE_NCLOB
              ? { type: oracledb.STRING }
              : metadata.dbType === oracledb.DB_TYPE_BLOB
                ? { type: oracledb.BUFFER }
                : undefined,
        });
      },
      (client) => client.close(),
    );
  }
  return {
    async select(sql, params) {
      return (await query(sql, params)).rows ?? [];
    },
    async execute(sql, params) {
      return (await query(sql, params)).rowsAffected ?? 0;
    },
    async close() {
      await pool?.close(0);
    },
  };
}
