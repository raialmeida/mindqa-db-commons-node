import type { ConnectionSettings } from '../types.js';
import type { DatabaseDriver } from './driver.js';

/** Carrega somente o driver do banco selecionado, sem mudar configurações globais. */
export async function createDriver(
  settings: ConnectionSettings,
): Promise<DatabaseDriver> {
  switch (settings.type) {
    case 'postgresql':
      return (await import('./postgresql.js')).createPostgresqlDriver(settings);
    case 'mysql':
      return (await import('./mysql.js')).createMysqlDriver(settings);
    case 'sqlserver':
      return (await import('./sqlserver.js')).createSqlserverDriver(settings);
    case 'oracle':
      return (await import('./oracle.js')).createOracleDriver(settings);
  }
}
