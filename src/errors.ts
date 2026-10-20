/**
 * Erro de seleção, leitura ou validação da configuração.
 *
 * A mensagem identifica a chave ou fonte inválida sem incluir credenciais. Uma
 * falha original de leitura ou parsing pode estar disponível em `cause`.
 */
export class DatabaseConfigurationError extends Error {
  override readonly name = 'DatabaseConfigurationError';
}

/**
 * Falha de conexão, execução ou liberação reportada pelo driver do banco.
 *
 * A mensagem pública é genérica e não acrescenta SQL, parâmetros ou credenciais.
 * O erro original do driver permanece disponível em `cause`.
 */
export class DatabaseError extends Error {
  override readonly name = 'DatabaseError';

  /**
   * Cria o erro público que preserva a falha original do driver.
   *
   * @param cause Erro original da operação ou da infraestrutura do driver.
   */
  constructor(cause: unknown) {
    super('Falha na operação de banco de dados.', { cause });
  }
}
