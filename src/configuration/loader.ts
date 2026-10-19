import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';
import { DatabaseConfigurationError } from '../errors.js';
import { fingerprint } from '../internal/fingerprint.js';
import { booleanValue, Configuration, type Values } from './configuration.js';

const cache = new Map<string, Configuration>();
const CACHE_LIMIT = 32;
let generation = 0;

export function clearConfigurationCache(): void {
  generation++;
  cache.clear();
}

/** DB_CONFIG > DB_ENV (.env.<perfil>) > .env. Arquivos não são mesclados. */
export async function loadConfiguration(): Promise<Configuration> {
  const environment: Record<string, string> = {};
  for (const key of Object.keys(process.env).sort()) {
    const value = process.env[key];
    if (
      /^(DB_|SQLSERVER_|POSTGRESQL_|MYSQL_|ORACLE_)/.test(key) &&
      value !== undefined
    )
      environment[key] = value;
  }
  const explicitPath = environment.DB_CONFIG?.trim();
  const profile = environment.DB_ENV?.trim();
  if (
    !explicitPath &&
    profile &&
    !/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(profile)
  ) {
    throw new DatabaseConfigurationError(
      'DB_ENV deve conter somente letras, números, hífen e sublinhado.',
    );
  }
  const location = resolve(
    explicitPath || (profile ? `.env.${profile}` : '.env'),
  );
  const explicit = Boolean(explicitPath || profile);
  const key = fingerprint([location, explicit, environment]);
  const currentGeneration = generation;
  const cached = cache.get(key);
  if (cached) {
    cache.delete(key);
    cache.set(key, cached);
    return cached;
  }
  let file: Values = {};
  try {
    file = parseEnv(await readFile(location, 'utf8'));
  } catch (error) {
    if (
      explicit ||
      !(error instanceof Error && 'code' in error && error.code === 'ENOENT')
    ) {
      throw new DatabaseConfigurationError(
        'Não foi possível ler o arquivo .env selecionado. Verifique DB_CONFIG e DB_ENV.',
        { cause: error },
      );
    }
  }
  const configuration = new Configuration(file, environment);
  const enabled = booleanValue(
    configuration.global('DB_CONFIG_CACHE_ENABLED'),
    'DB_CONFIG_CACHE_ENABLED',
    false,
  );
  if (enabled && currentGeneration === generation) {
    if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value!);
    cache.set(key, configuration);
  }
  return configuration;
}
