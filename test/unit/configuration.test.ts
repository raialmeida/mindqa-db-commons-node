import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Configuration } from '../../src/configuration/configuration.js';
import { connectionSettings } from '../../src/configuration/settings.js';
import {
  clearConfigurationCache,
  loadConfiguration,
} from '../../src/configuration/loader.js';

const fields = {
  DB_TYPE: 'postgresql',
  DB_HOST: 'localhost',
  DB_USER: 'qa',
  DB_PASS: ' secret ',
  DB_NAME: 'qa',
};
const folders: string[] = [];

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  clearConfigurationCache();
  await Promise.all(
    folders
      .splice(0)
      .map((folder) => rm(folder, { recursive: true, force: true })),
  );
});

describe('configuration', () => {
  it('prioritizes environment, including empty values; preserves password whitespace', () => {
    const settings = connectionSettings(new Configuration(fields, {}).select());
    expect(settings.password).toBe(' secret ');
    expect(settings.port).toBe(5432);
    expect(settings.poolEnabled).toBe(false);
    expect(() =>
      connectionSettings(new Configuration(fields, { DB_HOST: '' }).select()),
    ).toThrow('DB_HOST');
    expect(
      connectionSettings(new Configuration(fields, { DB_PASS: '' }).select())
        .password,
    ).toBe('');
  });

  it('selects a single alias automatically and resolves its type', () => {
    const configuration = new Configuration(
      {
        POSTGRESQL_HOST: 'localhost',
        POSTGRESQL_USER: 'qa',
        POSTGRESQL_PASS: '',
        POSTGRESQL_NAME: 'qa',
      },
      {},
    );
    expect(connectionSettings(configuration.select())).toMatchObject({
      type: 'postgresql',
      connectionName: 'postgresql',
    });
  });

  it('requires a default when multiple destinations exist', () => {
    expect(() =>
      new Configuration({ MYSQL_HOST: 'a', SQLSERVER_HOST: 'b' }, {}).select(),
    ).toThrow('várias conexões');
    expect(
      new Configuration(
        {
          MYSQL_HOST: 'a',
          SQLSERVER_HOST: 'b',
          DB_DEFAULT_CONNECTION: 'mysql',
        },
        {},
      )
        .select()
        .get('HOST'),
    ).toBe('a');
  });

  it('honors explicit names before default, trims names and never inherits credentials', () => {
    const config = new Configuration(
      {
        ...fields,
        DB_DEFAULT_CONNECTION: 'missing',
        DB_CONNECTIONS_ERP_TYPE: 'mysql',
        DB_CONNECTIONS_ERP_HOST: 'erp',
      },
      {},
    );
    const selected = config.select(' ERP ');
    expect(selected.get('HOST')).toBe('erp');
    expect(selected.get('PASS')).toBeUndefined();
    expect(() => config.select('unknown')).toThrow('não configurada');
    expect(() => config.select('invalid_name')).toThrow('ASCII');
  });

  it('prioritizes environment alias over standard file key and standard over alias in one source', () => {
    const config = new Configuration(
      {
        DB_CONNECTIONS_ERP_HOST: 'standard-file',
        MYSQL_ERP_HOST: 'alias-file',
      },
      { MYSQL_ERP_HOST: 'alias-env' },
    );
    expect(config.select('erp').get('HOST')).toBe('alias-env');
    const standard = new Configuration(
      {},
      { MYSQL_ERP_HOST: 'alias-env', DB_CONNECTIONS_ERP_HOST: 'standard-env' },
    );
    expect(standard.select('erp').get('HOST')).toBe('standard-env');
  });

  it('rejects conflicting aliases and contradictory types', () => {
    expect(() =>
      new Configuration(
        { MYSQL_ERP_HOST: 'a', ORACLE_ERP_HOST: 'b' },
        {},
      ).select('erp'),
    ).toThrow('mais de um prefixo');
    expect(() =>
      new Configuration({ MYSQL_ERP_TYPE: 'postgresql' }, {}).select('erp'),
    ).toThrow('contradiz');
  });

  it.each([
    ['DB_PORT', '65536'],
    ['DB_PORT', '1.5'],
    ['DB_POOL_MAX_SIZE', '0'],
    ['DB_QUERY_TIMEOUT_SECONDS', '-1'],
    ['DB_POOL_ENABLED', 'yes'],
    ['DB_HOST', 'localhost;password=secret'],
    ['DB_HOST', 'localhost:5432'],
    ['DB_NAME', 'bad\nname'],
    ['DB_ENCRYPT', 'invalid'],
  ])('validates %s without printing its value', (key, value) => {
    expect(() =>
      connectionSettings(
        new Configuration({ ...fields, [key]: value }, {}).select(),
      ),
    ).toThrow();
  });

  it('supports IPv6 and an explicit database without changing the source', () => {
    const selected = new Configuration(
      { ...fields, DB_HOST: '[::1]' },
      {},
    ).select();
    expect(connectionSettings(selected, 'other')).toMatchObject({
      host: '::1',
      database: 'other',
    });
    expect(connectionSettings(selected).database).toBe('qa');
  });

  it('permits validated driver options and rejects credential/SQL/prototype overrides', () => {
    const selected = (value: string) =>
      new Configuration({ ...fields, DB_DRIVER_OPTIONS: value }, {}).select();
    expect(
      connectionSettings(
        selected('{"application_name":"qa","ssl":{"rejectUnauthorized":true}}'),
      ).driverOptions,
    ).toEqual({ application_name: 'qa', ssl: { rejectUnauthorized: true } });
    for (const invalid of [
      '{"password":"secret"}',
      '{"__proto__":{}}',
      '{"options":"-c x=y"}',
      '{"ssl":{"__proto__":{}}}',
      '{"keepAlive":"false"}',
      '[]',
      '{',
    ]) {
      expect(() => connectionSettings(selected(invalid))).toThrow();
    }
  });
});

async function sandbox(): Promise<string> {
  const folder = await mkdtemp(join(tmpdir(), 'mindqa-config-'));
  folders.push(folder);
  vi.spyOn(process, 'cwd').mockReturnValue(folder);
  for (const key of Object.keys(process.env))
    if (/^(DB_|SQLSERVER_|POSTGRESQL_|MYSQL_|ORACLE_)/.test(key))
      vi.stubEnv(key, undefined);
  return folder;
}

describe('dotenv selection', () => {
  it('loads .env without modifying process.env and accepts quoted values', async () => {
    const folder = await sandbox();
    await writeFile(join(folder, '.env'), 'DB_HOST=file\nDB_PASS="a#b = c"\n');
    const config = await loadConfiguration();
    expect(config.select().get('PASS')).toBe('a#b = c');
    expect(process.env.DB_HOST).toBeUndefined();
  });

  it('uses DB_CONFIG before DB_ENV and never overlays .env into another environment', async () => {
    const folder = await sandbox();
    await writeFile(join(folder, '.env'), 'DB_PASS=default-secret');
    await writeFile(join(folder, '.env.hml'), 'DB_HOST=hml');
    await writeFile(join(folder, 'custom.env'), 'DB_HOST=custom');
    vi.stubEnv('DB_ENV', 'hml');
    expect((await loadConfiguration()).select().get('HOST')).toBe('hml');
    expect((await loadConfiguration()).select().get('PASS')).toBeUndefined();
    vi.stubEnv('DB_CONFIG', 'custom.env');
    expect((await loadConfiguration()).select().get('HOST')).toBe('custom');
  });

  it('allows absent default but rejects absent explicit file and path traversal profiles', async () => {
    await sandbox();
    vi.stubEnv('DB_HOST', 'environment');
    expect((await loadConfiguration()).select().get('HOST')).toBe(
      'environment',
    );
    vi.stubEnv('DB_CONFIG', 'missing.env');
    await expect(loadConfiguration()).rejects.toThrow('arquivo .env');
    vi.stubEnv('DB_CONFIG', undefined);
    vi.stubEnv('DB_ENV', '../outside');
    await expect(loadConfiguration()).rejects.toThrow('DB_ENV');
  });

  it('rereads files by default, caches only when enabled, and invalidates explicitly', async () => {
    const folder = await sandbox();
    const file = join(folder, '.env');
    await writeFile(file, 'DB_HOST=first');
    expect((await loadConfiguration()).select().get('HOST')).toBe('first');
    await writeFile(file, 'DB_HOST=second\nDB_CONFIG_CACHE_ENABLED=true');
    const cached = await loadConfiguration();
    await writeFile(file, 'DB_HOST=third\nDB_CONFIG_CACHE_ENABLED=true');
    expect(await loadConfiguration()).toBe(cached);
    clearConfigurationCache();
    expect((await loadConfiguration()).select().get('HOST')).toBe('third');
    vi.stubEnv('DB_HOST', 'environment-change');
    expect((await loadConfiguration()).select().get('HOST')).toBe(
      'environment-change',
    );
  });
});
