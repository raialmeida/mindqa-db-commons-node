/** Tipos de banco aceitos após a normalização da configuração. */
export type DatabaseType = 'postgresql' | 'sqlserver' | 'mysql' | 'oracle';

/**
 * Valores de entrada portáveis entre os quatro drivers.
 *
 * Números devem ser finitos; inteiros devem estar dentro do intervalo seguro do
 * JavaScript. Datas precisam ser válidas. Use `null` explicitamente para SQL
 * NULL. `undefined`, arrays e objetos arbitrários não são aceitos.
 */
export type DatabaseParameter =
  string | number | boolean | bigint | Date | Buffer | null;

/**
 * Linha genérica retornada por {@link DatabaseService.select} e
 * {@link DatabaseClient.select}.
 *
 * As chaves correspondem aos nomes ou aliases informados pelo driver. Os tipos
 * dos valores seguem as conversões do banco e do driver selecionado.
 */
export type DatabaseRow = Record<string, unknown>;

export interface ConnectionSettings {
  readonly type: DatabaseType;
  readonly connectionName: string | undefined;
  readonly host: string;
  readonly port: number;
  readonly user: string;
  readonly password: string;
  readonly database: string;
  readonly queryTimeoutMs: number;
  readonly loginTimeoutMs: number;
  readonly poolEnabled: boolean;
  readonly poolMaxSize: number;
  readonly poolConnectionTimeoutMs: number;
  readonly encrypt: boolean | 'strict';
  readonly trustServerCertificate: boolean;
  readonly driverOptions: Readonly<Record<string, unknown>>;
}
