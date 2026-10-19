import { normalizeConnectionName } from './configuration/configuration.js';
import { loadConfiguration } from './configuration/loader.js';
import { connectionSettings } from './configuration/settings.js';
import { withDriver } from './internal/pools.js';
import { bindPlaceholders, validateArguments } from './sql/parameters.js';
import type { DatabaseParameter, DatabaseRow } from './types.js';

/**
 * Operações de banco para uma conexão e uma base selecionadas.
 *
 * O cliente guarda somente os nomes selecionados. Ele é imutável, reutilizável
 * e pode ser compartilhado entre chamadas concorrentes. Sua criação não lê a
 * configuração nem abre conexões. Cada operação resolve um snapshot de
 * configuração próprio e usa uma conexão exclusiva enquanto estiver em curso.
 */
export class DatabaseClient {
  readonly #connectionName: string | undefined;
  readonly #databaseName: string | undefined;

  /**
   * Cria um cliente sem realizar I/O.
   *
   * Normalmente o consumidor obtém instâncias por
   * {@link DatabaseService.connection} ou {@link DatabaseService.database}.
   * Sem um nome de conexão, o cliente usa a conexão padrão. Um nome de base
   * ausente ou em branco usa a base configurada.
   *
   * @param connectionName Nome opcional da conexão configurada.
   * @param databaseName Nome opcional da base ou service name no Oracle. Um
   * valor nulo ou em branco usa a base configurada.
   * @throws {TypeError} Quando o nome da conexão estiver vazio ou tiver formato
   * inválido, ou quando o nome da base não for uma string, `null` ou
   * `undefined`.
   */
  constructor(connectionName?: string, databaseName?: string | null) {
    this.#connectionName =
      connectionName === undefined
        ? undefined
        : normalizeConnectionName(connectionName);
    if (
      databaseName !== undefined &&
      databaseName !== null &&
      typeof databaseName !== 'string'
    )
      throw new TypeError('O nome da base deve ser uma string.');
    this.#databaseName = databaseName?.trim() || undefined;
    Object.freeze(this);
  }

  /**
   * Cria um cliente para outra base, preservando a conexão, as credenciais e as
   * demais opções deste cliente.
   *
   * A chamada não altera a instância atual, não lê a configuração e não abre
   * conexões. No Oracle, o nome representa o service name, não o schema. Um
   * valor nulo, ausente ou em branco retoma a base configurada.
   *
   * @param name Nome da base de destino ou service name no Oracle.
   * @returns Novo cliente imutável com a base selecionada.
   * @throws {TypeError} Quando o nome informado não for uma string, `null` ou
   * `undefined`.
   */
  database(name?: string | null): DatabaseClient {
    return new DatabaseClient(this.#connectionName, name ?? undefined);
  }

  /**
   * Executa uma consulta usando a conexão e a base selecionadas por este cliente.
   *
   * Os parâmetros substituem os placeholders `?` na ordem informada e são
   * enviados separadamente ao driver. Use `null` para representar SQL NULL.
   *
   * @typeParam T Estrutura esperada para cada linha. O tipo auxilia o
   * compilador, mas não valida os dados em tempo de execução.
   * @param sql SQL com placeholders `?` para valores.
   * @param params Valores correspondentes aos placeholders.
   * @returns Promise com as linhas indexadas pelo nome ou alias das colunas;
   * retorna uma lista vazia quando nenhum registro for encontrado.
   * @throws {TypeError} A Promise rejeita quando o SQL estiver vazio, a
   * quantidade de placeholders for diferente da quantidade de parâmetros ou
   * algum parâmetro não for suportado.
   * @throws {DatabaseConfigurationError} A Promise rejeita quando a conexão não
   * estiver configurada, faltar uma configuração obrigatória ou o arquivo `.env`
   * selecionado não puder ser lido.
   * @throws {DatabaseError} A Promise rejeita quando o driver falhar ao abrir,
   * executar ou liberar a conexão. O erro original fica em `cause`.
   */
  async select<T extends object = DatabaseRow>(
    sql: string,
    ...params: DatabaseParameter[]
  ): Promise<T[]> {
    const { settings, statement } = await this.prepare(sql, params);
    return withDriver(
      settings,
      async (driver) => (await driver.select(statement, params)) as T[],
    );
  }

  /**
   * Executa INSERT, UPDATE ou DELETE usando a conexão e a base selecionadas por
   * este cliente.
   *
   * Os parâmetros substituem os placeholders `?` na ordem informada e são
   * enviados separadamente ao driver. A operação usa auto-commit e não é
   * repetida automaticamente em caso de falha.
   *
   * @param sql SQL com placeholders `?` para valores.
   * @param params Valores correspondentes aos placeholders. Use `null` para
   * SQL NULL.
   * @returns Promise com a quantidade de linhas afetadas, não o ID gerado.
   * @throws {TypeError} A Promise rejeita quando o SQL estiver vazio, a
   * quantidade de placeholders for diferente da quantidade de parâmetros ou
   * algum parâmetro não for suportado.
   * @throws {DatabaseConfigurationError} A Promise rejeita quando a conexão não
   * estiver configurada, faltar uma configuração obrigatória ou o arquivo `.env`
   * selecionado não puder ser lido.
   * @throws {DatabaseError} A Promise rejeita quando o driver falhar ao abrir,
   * executar ou liberar a conexão. O erro original fica em `cause`.
   */
  async execute(sql: string, ...params: DatabaseParameter[]): Promise<number> {
    const { settings, statement } = await this.prepare(sql, params);
    return withDriver(settings, (driver) => driver.execute(statement, params));
  }

  private async prepare(sql: string, params: readonly DatabaseParameter[]) {
    validateArguments(sql, params);
    const configuration = await loadConfiguration();
    const settings = connectionSettings(
      configuration.select(this.#connectionName),
      this.#databaseName,
    );
    return {
      settings,
      statement: bindPlaceholders(sql, params.length, settings.type),
    };
  }
}
