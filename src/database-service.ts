import { DatabaseClient } from './database-client.js';
import { clearConfigurationCache } from './configuration/loader.js';
import { closePools } from './internal/pools.js';
import type { DatabaseParameter, DatabaseRow } from './types.js';

const defaultClient = new DatabaseClient();

/**
 * CRUD assíncrono para SQL Server, PostgreSQL, Oracle e MySQL.
 *
 * Os métodos estáticos usam a conexão padrão. Para selecionar uma conexão
 * nomeada, use {@link DatabaseService.connection}. O tipo, o destino e as
 * credenciais vêm das variáveis de ambiente ou do arquivo `.env` selecionado.
 * Cada operação usa uma conexão própria em auto-commit e a fecha ou devolve ao
 * pool ao terminar.
 */
export class DatabaseService {
  private constructor() {}

  /**
   * Seleciona uma conexão configurada pelo nome, sem ler a configuração ou
   * abrir uma conexão com o banco.
   *
   * @param name Nome da conexão. Deve começar com uma letra e conter somente
   * letras ASCII e números. Espaços nas extremidades e diferenças entre
   * maiúsculas e minúsculas são ignorados.
   * @returns Cliente imutável e reutilizável para a conexão selecionada.
   * @throws {TypeError} Quando o nome não for uma string, estiver vazio ou
   * possuir formato inválido.
   *
   * @example
   * ```ts
   * const financeiro = DatabaseService.connection('financeiro');
   * const rows = await financeiro.select('SELECT nome FROM clientes');
   * ```
   */
  static connection(name: string): DatabaseClient {
    if (typeof name !== 'string')
      throw new TypeError('Informe o nome da conexão.');
    return new DatabaseClient(name);
  }

  /**
   * Cria um cliente para outra base da conexão padrão.
   *
   * A chamada não altera o cliente padrão, não lê arquivos e não abre uma
   * conexão. No Oracle, o nome representa o service name, não o schema. Um
   * valor nulo, ausente ou em branco mantém a base configurada.
   *
   * @param name Nome da base de destino ou service name no Oracle.
   * @returns Novo cliente imutável para a base selecionada.
   * @throws {TypeError} Quando o nome informado não for uma string, `null` ou
   * `undefined`.
   */
  static database(name?: string | null): DatabaseClient {
    return defaultClient.database(name);
  }

  /**
   * Executa uma consulta usando a conexão e a base padrão selecionadas pela
   * configuração.
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
   * @throws {DatabaseConfigurationError} A Promise rejeita quando faltar uma
   * configuração obrigatória, a conexão padrão for ambígua ou o arquivo `.env`
   * selecionado não puder ser lido.
   * @throws {DatabaseError} A Promise rejeita quando o driver falhar ao abrir,
   * executar ou liberar a conexão. O erro original fica em `cause`.
   *
   * @example
   * ```ts
   * interface Cliente { nome: string; email: string }
   * const clientes = await DatabaseService.select<Cliente>(
   *   'SELECT nome, email FROM clientes WHERE id = ?',
   *   'cliente-1',
   * );
   * ```
   */
  static select<T extends object = DatabaseRow>(
    sql: string,
    ...params: DatabaseParameter[]
  ): Promise<T[]> {
    return defaultClient.select<T>(sql, ...params);
  }

  /**
   * Executa INSERT, UPDATE ou DELETE usando a conexão e a base padrão
   * selecionadas pela configuração.
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
   * @throws {DatabaseConfigurationError} A Promise rejeita quando faltar uma
   * configuração obrigatória, a conexão padrão for ambígua ou o arquivo `.env`
   * selecionado não puder ser lido.
   * @throws {DatabaseError} A Promise rejeita quando o driver falhar ao abrir,
   * executar ou liberar a conexão. O erro original fica em `cause`.
   */
  static execute(sql: string, ...params: DatabaseParameter[]): Promise<number> {
    return defaultClient.execute(sql, ...params);
  }

  /**
   * Descarta os snapshots de configuração mantidos em cache.
   *
   * A próxima operação volta a ler a fonte selecionada. Operações já iniciadas
   * mantêm seu snapshot e os pools de conexão não são fechados por esta chamada.
   * Sem `DB_CONFIG_CACHE_ENABLED=true`, a chamada não produz efeito observável.
   *
   * @returns Nada.
   */
  static clearConfigurationCache(): void {
    clearConfigurationCache();
  }

  /**
   * Fecha todos os pools mantidos pela biblioteca.
   *
   * Chame no encerramento da suíte, depois de aguardar as operações em curso.
   * Uma operação posterior pode criar novos pools. Chamadas realizadas enquanto
   * o fechamento está em andamento aguardam sua conclusão.
   *
   * @returns Promise concluída quando todos os pools tiverem sido processados.
   * @throws {DatabaseError} A Promise rejeita quando um ou mais pools não podem
   * ser fechados. Todas as tentativas de fechamento são realizadas e as causas
   * ficam preservadas no erro.
   */
  static closePools(): Promise<void> {
    return closePools();
  }
}
