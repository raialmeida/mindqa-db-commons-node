import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DatabaseService,
  DatabaseClient,
  DatabaseError,
} from '../../src/index.js';
import { createDriver } from '../../src/drivers/factory.js';
import { withDriver } from '../../src/internal/pools.js';
import { connectionSettings } from '../../src/configuration/settings.js';
import { Configuration } from '../../src/configuration/configuration.js';
import type { DatabaseDriver } from '../../src/drivers/driver.js';

vi.mock('../../src/drivers/factory.js', () => ({ createDriver: vi.fn() }));
const factory = vi.mocked(createDriver);
const fields = {
  DB_TYPE: 'postgresql',
  DB_HOST: 'host',
  DB_USER: 'user',
  DB_PASS: 'password',
  DB_NAME: 'qa',
};
const settings = connectionSettings(new Configuration(fields, {}).select());
const driver = (): DatabaseDriver => ({
  select: vi.fn().mockResolvedValue([{ id: 1 }]),
  execute: vi.fn().mockResolvedValue(2),
  close: vi.fn().mockResolvedValue(undefined),
});

afterEach(async () => {
  await DatabaseService.closePools().catch(() => undefined);
  vi.unstubAllEnvs();
  vi.resetAllMocks();
  DatabaseService.clearConfigurationCache();
});

describe('pool lifecycle', () => {
  it('closes a nonpooled driver on success and on error', async () => {
    const current = driver();
    factory.mockResolvedValue(current);
    await expect(
      withDriver(settings, (value) => value.execute('sql', [])),
    ).resolves.toBe(2);
    expect(current.close).toHaveBeenCalledTimes(1);
    const failure = new Error('driver failure');
    await expect(
      withDriver(settings, async () => {
        throw failure;
      }),
    ).rejects.toMatchObject({ cause: failure });
    expect(current.close).toHaveBeenCalledTimes(2);
  });

  it('shares a single pending pool across concurrent operations', async () => {
    const current = driver();
    factory.mockResolvedValue(current);
    await Promise.all(
      Array.from({ length: 10 }, () =>
        withDriver({ ...settings, poolEnabled: true }, (value) =>
          value.select('sql', []),
        ),
      ),
    );
    expect(factory).toHaveBeenCalledTimes(1);
    expect(current.close).not.toHaveBeenCalled();
    await DatabaseService.closePools();
    expect(current.close).toHaveBeenCalledTimes(1);
    await withDriver({ ...settings, poolEnabled: true }, (value) =>
      value.select('sql', []),
    );
    expect(factory).toHaveBeenCalledTimes(2);
  });

  it('evicts failed initialization so later attempts can recover', async () => {
    factory
      .mockRejectedValueOnce(new Error('unavailable'))
      .mockResolvedValue(driver());
    await expect(
      withDriver({ ...settings, poolEnabled: true }, async () => 1),
    ).rejects.toBeInstanceOf(DatabaseError);
    await expect(
      withDriver({ ...settings, poolEnabled: true }, async () => 1),
    ).resolves.toBe(1);
    expect(factory).toHaveBeenCalledTimes(2);
  });

  it('isolates credentials and database names, and caps the registry', async () => {
    factory.mockImplementation(async () => driver());
    await withDriver({ ...settings, poolEnabled: true }, async () => 1);
    await withDriver(
      { ...settings, poolEnabled: true, password: 'changed' },
      async () => 1,
    );
    await withDriver(
      { ...settings, poolEnabled: true, database: 'other' },
      async () => 1,
    );
    expect(factory).toHaveBeenCalledTimes(3);
    for (let index = 0; index < 31; index++)
      await withDriver(
        { ...settings, poolEnabled: true, database: `qa${index}` },
        async () => 1,
      );
    expect(factory.mock.calls.at(-1)?.[0].poolEnabled).toBe(false);
  });

  it('tries every pool on shutdown even when one close fails', async () => {
    const first = driver();
    const second = driver();
    vi.mocked(first.close).mockRejectedValue(new Error('close failed'));
    factory.mockResolvedValueOnce(first).mockResolvedValueOnce(second);
    await withDriver({ ...settings, poolEnabled: true }, async () => 1);
    await withDriver(
      { ...settings, poolEnabled: true, database: 'other' },
      async () => 1,
    );
    await expect(DatabaseService.closePools()).rejects.toBeInstanceOf(
      DatabaseError,
    );
    expect(second.close).toHaveBeenCalled();
  });
});

describe('public API', () => {
  it('rejects missing names passed by JavaScript callers', () => {
    expect(() =>
      DatabaseService.connection(undefined as unknown as string),
    ).toThrow('nome da conexão');
  });
  it('validates arguments before configuration and exposes a lazy immutable client', async () => {
    const client = DatabaseService.connection('ERP');
    expect(client).toBeInstanceOf(DatabaseClient);
    expect(Object.isFrozen(client)).toBe(true);
    expect(client.database('other')).not.toBe(client);
    await expect(client.select('')).rejects.toThrow('vazio');
    expect(factory).not.toHaveBeenCalled();
  });

  it('supports Java-style rest parameters, typed interfaces and database overrides', async () => {
    for (const [key, value] of Object.entries(fields)) vi.stubEnv(key, value);
    vi.stubEnv('DB_CONFIG', undefined);
    vi.stubEnv('DB_ENV', undefined);
    vi.stubEnv('DB_DEFAULT_CONNECTION', undefined);
    const current = driver();
    factory.mockResolvedValue(current);
    interface Row {
      id: number;
    }
    const result = await DatabaseService.database('override').select<Row>(
      'SELECT ? AS id',
      1,
    );
    expect(result[0]?.id).toBe(1);
    expect(current.select).toHaveBeenCalledWith('SELECT $1 AS id', [1]);
    expect(factory.mock.calls[0]?.[0].database).toBe('override');
    expect(
      await DatabaseService.execute('DELETE FROM clients WHERE id = ?', 1),
    ).toBe(2);
  });
});
