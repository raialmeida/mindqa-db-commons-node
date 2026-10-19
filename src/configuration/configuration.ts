import { DatabaseConfigurationError } from '../errors.js';
import type { DatabaseType } from '../types.js';

export type Values = Readonly<Record<string, string | undefined>>;

export const CONNECTION_FIELDS = [
  'TYPE',
  'HOST',
  'PORT',
  'USER',
  'PASS',
  'NAME',
  'QUERY_TIMEOUT_SECONDS',
  'LOGIN_TIMEOUT_SECONDS',
  'POOL_ENABLED',
  'POOL_MAX_SIZE',
  'POOL_CONNECTION_TIMEOUT_MS',
  'ENCRYPT',
  'TRUST_SERVER_CERTIFICATE',
  'DRIVER_OPTIONS',
] as const;
const PREFIXES = ['SQLSERVER', 'POSTGRESQL', 'MYSQL', 'ORACLE'] as const;

export function normalizeConnectionName(name: string): string {
  if (typeof name !== 'string' || !/^[a-z][a-z0-9]*$/i.test(name.trim())) {
    throw new TypeError(
      'O nome da conexão deve começar com uma letra e conter somente letras ASCII e números.',
    );
  }
  return name.trim().toLowerCase();
}

export function databaseType(value: string | undefined): DatabaseType {
  const normalized = value?.trim().toLowerCase() || 'sqlserver';
  if (normalized === 'postgres') return 'postgresql';
  if (['sqlserver', 'postgresql', 'mysql', 'oracle'].includes(normalized))
    return normalized as DatabaseType;
  throw new DatabaseConfigurationError(
    'DB_TYPE deve ser sqlserver, postgresql, postgres, mysql ou oracle.',
  );
}

/** Snapshot independente do ambiente global. Cada destino tem seu próprio namespace. */
export class Configuration {
  private readonly file: Values;
  private readonly environment: Values;

  constructor(file: Values, environment: Values) {
    this.file = Object.freeze({ ...file });
    this.environment = Object.freeze({ ...environment });
  }

  global(key: string): string | undefined {
    return this.environment[key] ?? this.file[key];
  }

  select(requestedName?: string): SelectedConfiguration {
    let name =
      requestedName ??
      (this.global('DB_DEFAULT_CONNECTION')?.trim() || undefined);
    if (
      !name &&
      !CONNECTION_FIELDS.some(
        (field) => this.global(`DB_${field}`) !== undefined,
      )
    ) {
      const names = this.names();
      if (names.size > 1) {
        throw new DatabaseConfigurationError(
          'Há várias conexões configuradas. Defina DB_DEFAULT_CONNECTION ou use connection(nome).',
        );
      }
      name = names.values().next().value;
    }
    name = name === undefined ? undefined : normalizeConnectionName(name);
    const aliases =
      name === undefined
        ? []
        : PREFIXES.flatMap((prefix) => {
            const candidates =
              prefix.toLowerCase() === name
                ? [prefix, `${prefix}_${name.toUpperCase()}`]
                : [`${prefix}_${name.toUpperCase()}`];
            return candidates.filter((candidate) =>
              CONNECTION_FIELDS.some(
                (field) => this.global(`${candidate}_${field}`) !== undefined,
              ),
            );
          });
    if (aliases.length > 1) {
      throw new DatabaseConfigurationError(
        `A conexão '${name}' possui mais de um prefixo. Use nomes distintos para cada destino.`,
      );
    }
    const selected = new SelectedConfiguration(
      this.file,
      this.environment,
      name,
      aliases[0],
    );
    if (
      name &&
      !CONNECTION_FIELDS.some((field) => selected.get(field) !== undefined)
    ) {
      throw new DatabaseConfigurationError(
        `Conexão '${name}' não configurada.`,
      );
    }
    return selected;
  }

  private names(): Set<string> {
    const names = new Set<string>();
    for (const key of new Set([
      ...Object.keys(this.file),
      ...Object.keys(this.environment),
    ])) {
      for (const field of CONNECTION_FIELDS) {
        for (const prefix of ['DB_CONNECTIONS', ...PREFIXES]) {
          if (key === `${prefix}_${field}` && prefix !== 'DB_CONNECTIONS')
            names.add(prefix.toLowerCase());
          const start = `${prefix}_`;
          const end = `_${field}`;
          if (key.startsWith(start) && key.endsWith(end)) {
            const name = key.slice(start.length, -end.length);
            if (/^[A-Z][A-Z0-9]*$/.test(name)) names.add(name.toLowerCase());
          }
        }
      }
    }
    return names;
  }
}

export class SelectedConfiguration {
  constructor(
    private readonly file: Values,
    private readonly environment: Values,
    readonly name: string | undefined,
    private readonly alias: string | undefined,
  ) {}

  key(field: string): string {
    return `${this.alias ?? (this.name ? `DB_CONNECTIONS_${this.name.toUpperCase()}` : 'DB')}_${field}`;
  }

  get(field: string): string | undefined {
    const standard = `${this.name ? `DB_CONNECTIONS_${this.name.toUpperCase()}` : 'DB'}_${field}`;
    const alias = this.key(field);
    const value =
      this.environment[standard] ??
      this.environment[alias] ??
      this.file[standard] ??
      this.file[alias];
    if (field !== 'TYPE' || !this.alias) return value;
    const inferred = databaseType(this.alias.split('_')[0]);
    if (value?.trim() && databaseType(value) !== inferred) {
      throw new DatabaseConfigurationError(
        `O tipo da conexão '${this.name}' contradiz seu prefixo.`,
      );
    }
    return inferred;
  }

  required(field: string): string {
    const value = this.get(field)?.trim();
    if (!value)
      throw new DatabaseConfigurationError(
        `Defina ${this.key(field)} nas variáveis de ambiente ou no arquivo .env selecionado.`,
      );
    return value;
  }
}

export function booleanValue(
  value: string | undefined,
  key: string,
  fallback: boolean,
): boolean {
  if (!value?.trim()) return fallback;
  if (value.trim().toLowerCase() === 'true') return true;
  if (value.trim().toLowerCase() === 'false') return false;
  throw new DatabaseConfigurationError(`${key} deve ser true ou false.`);
}
