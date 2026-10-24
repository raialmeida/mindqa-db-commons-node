# @mindqa/db-commons

[![Node CI](https://github.com/raialmeida/mindqa-db-commons-node/actions/workflows/ci.yml/badge.svg)](https://github.com/raialmeida/mindqa-db-commons-node/actions/workflows/ci.yml)

Biblioteca para executar consultas e operações em **PostgreSQL, SQL Server,
MySQL e Oracle** em testes automatizados JavaScript e TypeScript.

A configuração pode ser carregada por variáveis de ambiente ou arquivos `.env`.
A biblioteca oferece uma API assíncrona para Node.js e uma integração própria
para tarefas do Cypress.

A documentação completa, com configurações, métodos, exemplos e solução de
problemas, está disponível na [Wiki do projeto](https://github.com/raialmeida/mindqa-db-commons-node/wiki).

## Instalação

Use Node.js 22 ou superior:

```bash
npm install --save-dev @mindqa/db-commons
```

Os drivers dos quatro bancos são instalados com o pacote. A biblioteca oferece
suporte a ESM, CommonJS e declarações TypeScript.

## Configuração

Crie um arquivo `.env` no diretório em que os testes são executados:

```dotenv
POSTGRESQL_HOST=localhost
POSTGRESQL_PORT=5432
POSTGRESQL_USER=qa_user
POSTGRESQL_PASS="sua_senha"
POSTGRESQL_NAME=qa_database
```

O arquivo é carregado automaticamente. Variáveis de ambiente têm prioridade
sobre os valores do `.env`. Consulte [Referência de configuração](https://github.com/raialmeida/mindqa-db-commons-node/wiki/Refer%C3%AAncia-de-configura%C3%A7%C3%A3o) para configurar outros campos da conexão.

Use os prefixos abaixo para configurar outro banco:

| Banco      | Prefixo       | Porta padrão |
| ---------- | ------------- | ------------ |
| PostgreSQL | `POSTGRESQL_` | `5432`       |
| SQL Server | `SQLSERVER_`  | `1433`       |
| MySQL      | `MYSQL_`      | `3306`       |
| Oracle     | `ORACLE_`     | `1521`       |

Todos usam os campos `HOST`, `USER`, `PASS` e `NAME`. No Oracle,
`NAME` representa o service name. `PORT` é opcional e usa a porta padrão do banco quando omitido.

Para selecionar uma configuração por ambiente, crie arquivos como `.env.hml`
ou `.env.qa` e informe o perfil antes de executar os testes:

```bash
DB_ENV=hml npm test
```

Também é possível selecionar um arquivo diretamente:

```bash
DB_CONFIG=config/qa.env npm test
```

Consulte na Wiki a [configuração por ambiente](https://github.com/raialmeida/mindqa-db-commons-node/wiki/Configuração-por-ambiente)
e a configuração de [múltiplas conexões e bases](https://github.com/raialmeida/mindqa-db-commons-node/wiki/Múltiplas-conexões-e-bases).

## Uso

Use `select()` para consultas e `execute()` para `INSERT`, `UPDATE` e `DELETE`:

```javascript
import { DatabaseService } from '@mindqa/db-commons';

const clientes = await DatabaseService.select(
  'SELECT nome, email FROM clientes WHERE id = ?',
  'cliente-1',
);

const removidos = await DatabaseService.execute(
  'DELETE FROM clientes WHERE id = ?',
  'cliente-1',
);
```

Os parâmetros substituem os placeholders `?` na ordem informada e são enviados
separadamente ao driver. Não concatene valores diretamente no SQL.

Para consultar outra base usando a conexão padrão:

```javascript
const auditoria = await DatabaseService.database('qa_auditoria').select(
  'SELECT evento FROM auditoria WHERE cliente_id = ?',
  'cliente-1',
);
```

Para usar o alias de uma conexão configurada:

```javascript
const financeiro = DatabaseService.connection('financeiro');

const lancamentos = await financeiro.select(
  'SELECT descricao, valor FROM lancamentos WHERE id = ?',
  10,
);
```

Métodos disponíveis:

| Método                      | Retorno           | Descrição                                      |
| --------------------------- | ----------------- | ---------------------------------------------- |
| `select(sql, ...params)`    | `Promise<T[]>`    | Retorna as linhas encontradas.                 |
| `execute(sql, ...params)`   | `Promise<number>` | Retorna a quantidade de linhas afetadas.       |
| `connection(nome)`          | `DatabaseClient`  | Seleciona uma conexão configurada.             |
| `database(nome)`            | `DatabaseClient`  | Seleciona outra base na conexão atual.         |
| `clearConfigurationCache()` | `void`            | Limpa o cache opcional de configuração.        |
| `closePools()`              | `Promise<void>`   | Fecha todos os pools mantidos pela biblioteca. |

Em CommonJS, use:

```javascript
const { DatabaseService } = require('@mindqa/db-commons');
```

## Cypress

Para configurações detalhadas, parâmetros aceitos, conexões, bases, pools e
tratamento de erros, consulte a página [Cypress na Wiki](https://github.com/raialmeida/mindqa-db-commons-node/wiki/Cypress).

O código do teste Cypress é executado no navegador. Registre as tarefas de banco
no processo Node por meio de `setupNodeEvents`:

```javascript
// cypress.config.js
const { defineConfig } = require('cypress');
const { createDatabaseTasks } = require('@mindqa/db-commons/cypress');

module.exports = defineConfig({
  e2e: {
    setupNodeEvents(on) {
      on('task', createDatabaseTasks());
    },
  },
});
```

Use qualquer SQL diretamente no teste:

```javascript
describe('clientes', () => {
  after(() => {
    cy.task('db:closePools');
  });

  it('consulta e valida um cliente', () => {
    cy.task('db:select', {
      sql: 'SELECT nome, email FROM clientes WHERE id = ?',
      params: ['cliente-1'],
      connection: 'postgresql',
      database: 'qa_database',
    }).then((clientes) => {
      expect(clientes).to.have.length(1);
      expect(clientes[0]).to.deep.equal({
        nome: 'Cliente QA',
        email: 'cliente@example.com',
      });
    });
  });
});
```

As tarefas disponíveis são:

| Tarefa          | Retorno            | Descrição                           |
| --------------- | ------------------ | ----------------------------------- |
| `db:select`     | Linhas da consulta | Executa uma consulta.               |
| `db:execute`    | Número             | Retorna a quantidade afetada.       |
| `db:closePools` | `null`             | Fecha os pools do processo Cypress. |

O objeto enviado para `db:select` ou `db:execute` aceita:

| Campo        | Obrigatório | Descrição                                                            |
| ------------ | ----------- | -------------------------------------------------------------------- |
| `sql`        | Sim         | Comando SQL com placeholders `?`.                                    |
| `params`     | Não         | Valores dos placeholders, na mesma ordem.                            |
| `connection` | Não         | Nome da conexão. Quando omitido, usa a conexão padrão.               |
| `database`   | Não         | Nome da base. Quando omitido, usa a base configurada para a conexão. |

Quando o SQL não tiver parâmetros, `params` pode ser omitido. Use nesse campo
apenas `string`, número finito, `boolean` ou `null`. Inteiros devem estar no
intervalo seguro do JavaScript, pois os valores atravessam a serialização do
`cy.task()`.

Quando uma operação falha, a mensagem apresentada pelo Cypress identifica a
tarefa, a conexão e a base quando informadas, além do erro original retornado
pelo driver. A biblioteca não acrescenta SQL, parâmetros ou credenciais, mas a
mensagem original pode conter detalhes fornecidos pelo driver.

## Playwright

Para mais exemplos de configuração, conexões nomeadas, outras bases, execução
paralela e tratamento de erros, consulte a página [Playwright na Wiki](https://github.com/raialmeida/mindqa-db-commons-node/wiki/Playwright).

O Playwright executa os testes em Node.js, portanto pode usar a API principal
diretamente, sem um adaptador específico:

```typescript
import { expect, test } from '@playwright/test';
import { DatabaseService } from '@mindqa/db-commons';

const postgresql = DatabaseService.connection('postgresql');
const sqlserver = DatabaseService.connection('sqlserver');

test.afterAll(async () => {
  await DatabaseService.closePools();
});

test('consulta usando a conexão padrão', async () => {
  const clientes = await DatabaseService.select(
    'SELECT nome, email FROM clientes WHERE id = ?',
    'cliente-1',
  );

  expect(clientes).toHaveLength(1);
  expect(clientes[0]).toEqual({
    nome: 'Cliente QA',
    email: 'cliente@example.com',
  });
});

test('consulta usando PostgreSQL', async () => {
  const clientes = await postgresql.select(
    'SELECT nome FROM clientes WHERE id = ?',
    'cliente-1',
  );

  expect(clientes).toHaveLength(1);
  expect(clientes[0]).toEqual({ nome: 'Cliente QA' });
});

test('consulta outra base usando SQL Server', async () => {
  const registros = await sqlserver
    .database('qa_auditoria')
    .select('SELECT evento FROM auditoria WHERE cliente_id = ?', 'cliente-1');

  expect(registros).not.toHaveLength(0);
  expect(registros[0]).toEqual({ evento: 'CLIENTE_CONSULTADO' });
});
```

Os exemplos pressupõem que as conexões `postgresql` e `sqlserver` estejam
configuradas.

## Pool e erros

O pool é desabilitado por padrão. Para habilitá-lo:

```dotenv
POSTGRESQL_POOL_ENABLED=true
POSTGRESQL_POOL_MAX_SIZE=5
```

Feche os pools no encerramento da suíte:

```javascript
await DatabaseService.closePools();
```

Argumentos inválidos geram `TypeError`, problemas de configuração geram
`DatabaseConfigurationError` e falhas do driver geram `DatabaseError`. O erro
original do driver fica disponível em `cause`.

## Licença

Distribuído sob a [licença MIT](LICENSE).
