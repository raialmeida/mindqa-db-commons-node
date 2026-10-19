import { createHmac, randomBytes } from 'node:crypto';

const secret = randomBytes(32);

/** Chaves internas não mantêm credenciais legíveis nem hashes reutilizáveis entre processos. */
export function fingerprint(value: unknown): string {
  return createHmac('sha256', secret)
    .update(JSON.stringify(value))
    .digest('hex');
}
