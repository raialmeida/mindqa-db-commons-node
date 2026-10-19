import { DatabaseError } from '../errors.js';
import { createDriver } from '../drivers/factory.js';
import type { DatabaseDriver } from '../drivers/driver.js';
import type { ConnectionSettings } from '../types.js';
import { fingerprint } from './fingerprint.js';
import { usingResource } from './resources.js';

const pools = new Map<string, Promise<DatabaseDriver>>();
const MAX_POOLS = 32;
let closing: Promise<void> | undefined;

export async function withDriver<T>(
  settings: ConnectionSettings,
  operation: (driver: DatabaseDriver) => Promise<T>,
): Promise<T> {
  try {
    if (closing) await closing;
    const key = fingerprint(settings);
    let pending = settings.poolEnabled ? pools.get(key) : undefined;
    if (!pending && settings.poolEnabled && pools.size < MAX_POOLS) {
      pending = createDriver(settings);
      pools.set(key, pending);
      const registered = pending;
      void pending.catch(() => {
        if (pools.get(key) === registered) pools.delete(key);
      });
    }
    if (pending) return await operation(await pending);
    // O limite não fecha pools em uso: destinos adicionais usam conexões diretas.
    return await usingResource(
      await createDriver({ ...settings, poolEnabled: false }),
      operation,
      (driver) => driver.close(),
    );
  } catch (error) {
    throw new DatabaseError(error);
  }
}

/** Chame após aguardar as operações da suíte; novas chamadas podem criar outros pools. */
export async function closePools(): Promise<void> {
  if (closing) return closing;
  const pending = [...pools.values()];
  pools.clear();
  closing = (async () => {
    const results = await Promise.allSettled(
      pending.map(async (driver) => (await driver).close()),
    );
    const errors = results
      .filter((result) => result.status === 'rejected')
      .map((result) => result.reason as unknown);
    if (errors.length)
      throw new DatabaseError(
        new AggregateError(errors, 'Falha ao fechar pools.'),
      );
  })();
  try {
    await closing;
  } finally {
    closing = undefined;
  }
}
