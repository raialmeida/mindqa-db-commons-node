import { DatabaseService, type DatabaseRow } from '@mindqa/db-commons';

/**
 * Valor SQL que atravessa a serialização do `cy.task()` sem conversão de tipo.
 *
 * Números devem ser finitos; inteiros devem estar dentro do intervalo seguro do
 * JavaScript. Use `null` explicitamente para SQL NULL.
 *
 * Datas, binários e inteiros grandes não são aceitos diretamente. Converta-os
 * explicitamente para uma representação textual compatível com o SQL utilizado.
 */
export type CypressDatabaseParameter = string | number | boolean | null;

/**
 * Argumentos enviados pelo teste às tarefas `db:select` e `db:execute`.
 *
 * O SQL e os parâmetros atravessam o transporte do `cy.task()`. As credenciais
 * permanecem no processo Node e são resolvidas pelas variáveis de ambiente ou
 * pelo arquivo `.env` selecionado.
 */
export interface CypressDatabaseTaskInput {
  /**
   * SQL não vazio com placeholders `?` para valores.
   *
   * A consulta é enviada ao banco selecionado depois da conversão dos
   * placeholders para o dialeto correspondente. Passe os valores por `params`;
   * não concatene dados no SQL.
   */
  readonly sql: string;
  /**
   * Valores correspondentes aos placeholders `?`, na mesma ordem.
   *
   * O campo pode ser omitido quando o SQL não tiver parâmetros. Datas e inteiros
   * grandes podem ser enviados como texto ISO e decimal. Para binários, uma
   * representação como Base64 precisa ser decodificada explicitamente pelo SQL;
   * a biblioteca não a converte automaticamente em `Buffer`.
   */
  readonly params?: readonly CypressDatabaseParameter[];
  /**
   * Nome opcional de uma conexão configurada.
   *
   * Quando omitido, usa `DB_DEFAULT_CONNECTION`, a configuração raiz ou a única
   * conexão disponível.
   */
  readonly connection?: string;
  /**
   * Nome opcional da base de destino ou service name no Oracle.
   *
   * A base é aplicada sobre a conexão selecionada sem alterar host, porta,
   * credenciais ou opções. Quando omitida, nula ou em branco, usa a base
   * configurada para a conexão.
   */
  readonly database?: string | null;
}

/** Tarefas de banco registradas no `setupNodeEvents` do Cypress. */
export type CypressDatabaseTasks = {
  /**
   * Executa uma consulta usando a conexão e a base selecionadas.
   *
   * @param input SQL, parâmetros e seleção opcional de conexão e base.
   * @returns Promise com as linhas encontradas; retorna uma lista vazia quando
   * nenhum registro for encontrado. Os valores retornados atravessam a
   * serialização do Cypress antes de chegar ao teste.
   * @throws {TypeError} A Promise rejeita quando o objeto da tarefa, `sql` ou
   * `params` forem inválidos.
   * @throws {Error} A Promise rejeita com uma mensagem serializável que identifica
   * a tarefa, a conexão, a base e a cadeia de causas do erro original.
   */
  'db:select': (input: CypressDatabaseTaskInput) => Promise<DatabaseRow[]>;
  /**
   * Executa INSERT, UPDATE ou DELETE usando a conexão e a base selecionadas.
   *
   * @param input SQL, parâmetros e seleção opcional de conexão e base.
   * @returns Promise com a quantidade de linhas afetadas, não o ID gerado.
   * @throws {TypeError} A Promise rejeita quando o objeto da tarefa, `sql` ou
   * `params` forem inválidos.
   * @throws {Error} A Promise rejeita com uma mensagem serializável que identifica
   * a tarefa, a conexão, a base e a cadeia de causas do erro original.
   */
  'db:execute': (input: CypressDatabaseTaskInput) => Promise<number>;
  /**
   * Fecha todos os pools mantidos pela biblioteca no processo Node do Cypress.
   *
   * @returns Promise com `null`, pois uma tarefa Cypress não pode retornar
   * `undefined`. Uma operação posterior pode criar novos pools.
   * @throws {Error} A Promise rejeita com a cadeia de causas em uma mensagem
   * serializável quando um ou mais pools não podem ser fechados. Todas as
   * tentativas de fechamento são realizadas.
   */
  'db:closePools': () => Promise<null>;
};

function normalizeInput(input: CypressDatabaseTaskInput): {
  sql: string;
  params: CypressDatabaseParameter[];
  connection: string | undefined;
  database: string | null | undefined;
} {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new TypeError(
      'Os argumentos da tarefa de banco devem ser informados em um objeto.',
    );
  if (typeof input.sql !== 'string' || !input.sql.trim())
    throw new TypeError('O campo sql deve conter um comando SQL.');
  if (input.params !== undefined && !Array.isArray(input.params))
    throw new TypeError('O campo params deve ser uma lista de parâmetros SQL.');
  for (const value of input.params ?? []) {
    const valid =
      value === null ||
      typeof value === 'string' ||
      typeof value === 'boolean' ||
      (typeof value === 'number' &&
        Number.isFinite(value) &&
        (!Number.isInteger(value) || Number.isSafeInteger(value)));
    if (!valid)
      throw new TypeError(
        'Parâmetro Cypress inválido. Use string, número finito, boolean ou null. Inteiros devem estar no intervalo seguro do JavaScript. Converta datas e bigint para string; dados binários devem usar uma representação textual compatível com o SQL.',
      );
  }
  return {
    sql: input.sql,
    params: input.params === undefined ? [] : [...input.params],
    connection: input.connection,
    database: input.database,
  };
}

function clientFor(
  connection: string | undefined,
  database: string | null | undefined,
) {
  if (connection === undefined)
    return database === undefined
      ? DatabaseService
      : DatabaseService.database(database);
  const client = DatabaseService.connection(connection);
  return database === undefined ? client : client.database(database);
}

const MAX_SERIALIZED_ERRORS = 10;

function errorDescription(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const code =
    'code' in error &&
    (typeof error.code === 'string' || typeof error.code === 'number')
      ? ` [${String(error.code)}]`
      : '';
  return `${error.name}${code}: ${error.message}`;
}

function errorChain(error: unknown): string {
  let count = 0;
  const visited = new Set<unknown>();

  const serialize = (current: unknown): string => {
    if (count >= MAX_SERIALIZED_ERRORS) return '[erros adicionais truncados]';
    if (visited.has(current)) return '[causa circular]';
    visited.add(current);
    count++;

    if (
      current instanceof Error &&
      current.name === 'DatabaseError' &&
      current.cause !== undefined
    )
      return serialize(current.cause);

    const description = errorDescription(current);
    const aggregate =
      current instanceof AggregateError
        ? current.errors.map(serialize).join('; ')
        : '';
    const cause = current instanceof Error ? current.cause : undefined;
    return [
      description,
      aggregate ? `[${aggregate}]` : '',
      cause === undefined ? '' : serialize(cause),
    ]
      .filter(Boolean)
      .join(' <- ');
  };

  return serialize(error);
}

function taskError(
  task: keyof CypressDatabaseTasks,
  error: unknown,
  connection?: string,
  database?: string | null,
): Error {
  const selectedConnection =
    typeof connection === 'string' && connection.trim()
      ? connection.trim()
      : 'padrão';
  const selectedDatabase =
    typeof database === 'string' && database.trim()
      ? database.trim()
      : 'configurada';
  const target =
    task === 'db:closePools'
      ? ''
      : ` (conexão: ${selectedConnection}, base: ${selectedDatabase})`;
  return new Error(`Falha na tarefa ${task}${target}: ${errorChain(error)}`, {
    cause: error,
  });
}

/**
 * Cria tarefas genéricas de banco para o processo Node do Cypress.
 *
 * Registre o objeto retornado com `on('task', createDatabaseTasks())`.
 * As tarefas disponíveis são `db:select`, `db:execute` e `db:closePools`.
 *
 * @returns Novo conjunto de tarefas sem alterar configurações globais.
 *
 * @example
 * ```ts
 * import { defineConfig } from 'cypress';
 * import { createDatabaseTasks } from '@mindqa/db-commons/cypress';
 *
 * export default defineConfig({
 *   e2e: {
 *     setupNodeEvents(on) {
 *       on('task', createDatabaseTasks());
 *     },
 *   },
 * });
 * ```
 */
export function createDatabaseTasks(): CypressDatabaseTasks {
  return {
    'db:select': async (input) => {
      const { sql, params, connection, database } = normalizeInput(input);
      try {
        return await clientFor(connection, database).select(sql, ...params);
      } catch (error) {
        throw taskError('db:select', error, connection, database);
      }
    },
    'db:execute': async (input) => {
      const { sql, params, connection, database } = normalizeInput(input);
      try {
        return await clientFor(connection, database).execute(sql, ...params);
      } catch (error) {
        throw taskError('db:execute', error, connection, database);
      }
    },
    'db:closePools': async () => {
      try {
        await DatabaseService.closePools();
        return null;
      } catch (error) {
        throw taskError('db:closePools', error);
      }
    },
  };
}
