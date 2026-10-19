import { afterEach, expect, it, vi } from 'vitest';
import { acquireWithin, usingResource } from '../../src/internal/resources.js';

afterEach(() => vi.useRealTimers());

it('preserves the operation error and a cleanup failure', async () => {
  const original = new Error('query');
  const cleanup = new Error('close');
  const result = usingResource(
    {},
    async () => {
      throw original;
    },
    () => {
      throw cleanup;
    },
  );
  await expect(result).rejects.toMatchObject({ errors: [original, cleanup] });
});

it('disposes of a connection acquired after the pool timeout', async () => {
  vi.useFakeTimers();
  let resolve!: (connection: object) => void;
  const pending = new Promise<object>((done) => {
    resolve = done;
  });
  const dispose = vi.fn();
  const result = acquireWithin(pending, 50, dispose);
  const assertion = expect(result).rejects.toThrow('Tempo limite');
  await vi.advanceTimersByTimeAsync(50);
  await assertion;
  const connection = {};
  resolve(connection);
  await vi.runAllTimersAsync();
  expect(dispose).toHaveBeenCalledWith(connection);
});
