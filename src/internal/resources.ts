/** Preserva tanto a falha original quanto uma eventual falha de liberação. */
export async function usingResource<T, R>(
  resource: T,
  operation: (resource: T) => Promise<R>,
  release: (resource: T, failed: boolean) => Promise<void> | void,
): Promise<R> {
  let result: R;
  try {
    result = await operation(resource);
  } catch (original) {
    try {
      await release(resource, true);
    } catch (cleanup) {
      throw new AggregateError(
        [original, cleanup],
        'A operação e a liberação do recurso falharam.',
        { cause: cleanup },
      );
    }
    throw original;
  }
  await release(resource, false);
  return result;
}

/** Uma aquisição tardia é descartada, evitando vazamento após o timeout. */
export function acquireWithin<T>(
  pending: Promise<T>,
  milliseconds: number,
  dispose: (value: T) => void | Promise<void>,
): Promise<T> {
  return new Promise((resolve, reject) => {
    let expired = false;
    const timer = setTimeout(() => {
      expired = true;
      reject(new Error('Tempo limite ao obter uma conexão do pool.'));
    }, milliseconds);
    pending.then(
      (value) => {
        clearTimeout(timer);
        if (expired) {
          // Não há mais consumidor para esse erro; o recurso já está sendo descartado.
          void Promise.resolve()
            .then(() => dispose(value))
            .catch(() => undefined);
        } else resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        if (!expired) reject(error);
      },
    );
  });
}
