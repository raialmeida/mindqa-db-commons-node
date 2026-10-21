import { isIP } from 'node:net';
import { DatabaseConfigurationError } from '../errors.js';
import type { ConnectionSettings, DatabaseType } from '../types.js';
import {
  booleanValue,
  databaseType,
  type SelectedConfiguration,
} from './configuration.js';

const PORTS = { postgresql: 5432, sqlserver: 1433, mysql: 3306, oracle: 1521 };
const OPTIONS: Record<DatabaseType, readonly string[]> = {
  postgresql: ['application_name', 'ssl', 'keepAlive'],
  sqlserver: ['appName', 'useUTC', 'enableArithAbort'],
  mysql: [
    'charset',
    'timezone',
    'supportBigNumbers',
    'bigNumberStrings',
    'decimalNumbers',
    'dateStrings',
    'ssl',
  ],
  oracle: ['stmtCacheSize'],
};

function integer(
  config: SelectedConfiguration,
  field: string,
  fallback: number,
  min: number,
  max = 2_147_483_647,
): number {
  const value = config.get(field)?.trim();
  if (!value) return fallback;
  const number = Number(value);
  if (
    !/^\d+$/.test(value) ||
    !Number.isSafeInteger(number) ||
    number < min ||
    number > max
  ) {
    throw new DatabaseConfigurationError(
      `${config.key(field)} deve ser um inteiro entre ${min} e ${max}.`,
    );
  }
  return number;
}

function driverOptions(
  config: SelectedConfiguration,
  type: DatabaseType,
): Readonly<Record<string, unknown>> {
  const text = config.get('DRIVER_OPTIONS')?.trim();
  if (!text) return Object.freeze({});
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new DatabaseConfigurationError(
      `${config.key('DRIVER_OPTIONS')} deve conter um objeto JSON válido.`,
    );
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
    throw new DatabaseConfigurationError(
      'DB_DRIVER_OPTIONS deve conter um objeto JSON.',
    );
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (!OPTIONS[type].includes(key))
      throw new DatabaseConfigurationError(
        `Opção de driver não permitida para ${type}. Consulte a documentação de configuração.`,
      );
    if (key === 'ssl') {
      if (typeof value === 'boolean') {
        result[key] = type === 'mysql' && value ? Object.freeze({}) : value;
        continue;
      }
      if (!value || typeof value !== 'object' || Array.isArray(value))
        throw new DatabaseConfigurationError(
          'ssl deve ser booleano ou objeto TLS.',
        );
      const ssl: Record<string, unknown> = {};
      for (const [option, setting] of Object.entries(value)) {
        if (
          !['ca', 'cert', 'key', 'rejectUnauthorized'].includes(option) ||
          (option === 'rejectUnauthorized'
            ? typeof setting !== 'boolean'
            : typeof setting !== 'string')
        ) {
          throw new DatabaseConfigurationError(
            'Opção TLS inválida em DB_DRIVER_OPTIONS.',
          );
        }
        ssl[option] = setting;
      }
      result[key] = Object.freeze(ssl);
    } else {
      const stringOption = [
        'application_name',
        'appName',
        'charset',
        'timezone',
      ].includes(key);
      const valid =
        key === 'stmtCacheSize'
          ? Number.isSafeInteger(value) &&
            typeof value === 'number' &&
            value >= 0
          : typeof value === (stringOption ? 'string' : 'boolean');
      if (!valid)
        throw new DatabaseConfigurationError(
          `Tipo inválido para a opção ${key} em DB_DRIVER_OPTIONS.`,
        );
      result[key] = value;
    }
  }
  return Object.freeze(result);
}

export function connectionSettings(
  config: SelectedConfiguration,
  selectedDatabase?: string,
): ConnectionSettings {
  const type = databaseType(config.get('TYPE'));
  let host = config.required('HOST');
  if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1);
  if (!isIP(host) && !/^[a-zA-Z0-9_.-]+$/.test(host))
    throw new DatabaseConfigurationError(
      'DB_HOST deve conter somente o host ou IP; configure a porta em DB_PORT.',
    );
  const database = selectedDatabase?.trim() || config.required('NAME');
  if (
    [...database].some(
      (character) =>
        character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
    )
  )
    throw new DatabaseConfigurationError(
      'DB_NAME não pode conter caracteres de controle.',
    );
  if (type === 'oracle' && !/^[a-zA-Z0-9_.$-]+$/.test(database))
    throw new DatabaseConfigurationError(
      'DB_NAME deve conter um service name Oracle válido.',
    );
  const password = config.get('PASS');
  if (password === undefined)
    throw new DatabaseConfigurationError(
      `Defina ${config.key('PASS')}; use uma string vazia para senha vazia.`,
    );
  const encryptText = config.get('ENCRYPT')?.trim().toLowerCase();
  const encrypt =
    encryptText === 'strict'
      ? 'strict'
      : booleanValue(encryptText, config.key('ENCRYPT'), true);
  return Object.freeze({
    type,
    connectionName: config.name,
    host,
    port: integer(config, 'PORT', PORTS[type], 1, 65535),
    user: config.required('USER'),
    password,
    database,
    queryTimeoutMs:
      integer(config, 'QUERY_TIMEOUT_SECONDS', 0, 0, 2_147_483) * 1000,
    loginTimeoutMs:
      integer(config, 'LOGIN_TIMEOUT_SECONDS', 0, 0, 65535) * 1000,
    poolEnabled: booleanValue(
      config.get('POOL_ENABLED'),
      config.key('POOL_ENABLED'),
      false,
    ),
    poolMaxSize: integer(config, 'POOL_MAX_SIZE', 5, 1, 10000),
    poolConnectionTimeoutMs: integer(
      config,
      'POOL_CONNECTION_TIMEOUT_MS',
      30000,
      1,
    ),
    encrypt,
    trustServerCertificate: booleanValue(
      config.get('TRUST_SERVER_CERTIFICATE'),
      config.key('TRUST_SERVER_CERTIFICATE'),
      false,
    ),
    driverOptions: driverOptions(config, type),
  });
}
