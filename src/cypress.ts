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
   * @throws {TypeError} A Promise rejeita quando os argumentos forem inválidos.
   * @throws {DatabaseConfigurationError} A Promise rejeita quando a configuração
   * selecionada estiver ausente ou for inválida.
   * @throws {DatabaseError} A Promise rejeita quando o driver falhar; o Cypress
   * apresenta a falha da tarefa ao teste.
   */
  'db:select': (input: CypressDatabaseTaskInput) => Promise<DatabaseRow[]>;
  /**
   * Executa INSERT, UPDATE ou DELETE usando a conexão e a base selecionadas.
   *
   * @param input SQL, parâmetros e seleção opcional de conexão e base.
   * @returns Promise com a quantidade de linhas afetadas, não o ID gerado.
   * @throws {TypeError} A Promise rejeita quando os argumentos forem inválidos.
   * @throws {DatabaseConfigurationError} A Promise rejeita quando a configuração
   * selecionada estiver ausente ou for inválida.
   * @throws {DatabaseError} A Promise rejeita quando o driver falhar; o Cypress
   * apresenta a falha da tarefa ao teste.
   */
  'db:execute': (input: CypressDatabaseTaskInput) => Promise<number>;
  /**
   * Fecha todos os pools mantidos pela biblioteca no processo Node do Cypress.
   *
   * @returns Promise com `null`, pois uma tarefa Cypress não pode retornar
   * `undefined`. Uma operação posterior pode criar novos pools.
   * @throws {DatabaseError} A Promise rejeita quando um ou mais pools não podem
   * ser fechados; todas as tentativas de fechamento são realizadas.
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
    throw new TypeError('Informe os argumentos da tarefa de banco.');
  if (input.params !== undefined && !Array.isArray(input.params))
    throw new TypeError('params deve ser uma lista de parâmetros SQL.');
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
        'Parâmetro Cypress inválido. Use string, número finito seguro, boolean ou null; envie datas, binários e inteiros grandes como string.',
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
      return clientFor(connection, database).select(sql, ...params);
    },
    'db:execute': async (input) => {
      const { sql, params, connection, database } = normalizeInput(input);
      return clientFor(connection, database).execute(sql, ...params);
    },
    'db:closePools': async () => {
      await DatabaseService.closePools();
      return null;
    },
  };
}
