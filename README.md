# MindQA DB Commons for Node.js

[![Node CI](https://github.com/raialmeida/mindqa-db-commons-node/actions/workflows/ci.yml/badge.svg)](https://github.com/raialmeida/mindqa-db-commons-node/actions/workflows/ci.yml)

Biblioteca para executar CRUD em **SQL Server, PostgreSQL, Oracle e MySQL**
em automações JavaScript e TypeScript, com configuração por variáveis de ambiente
ou arquivos `.env`. Use uma conexão padrão ou selecione conexões e bases diferentes
no mesmo teste.

Inspirada na [MindQA DB Commons para Java](https://github.com/raialmeida/mindqa-db-commons),
mantém `DatabaseService.select`, `execute`, `connection` e `database`, com `await`.
Cada operação usa sua própria conexão em auto-commit e a fecha ao terminar.
Pool de conexões e cache de configuração podem ser habilitados separadamente.

Funciona no processo **Node.js** de automações de API, interface e integração,
como Playwright Test, Selenium WebDriver, Cucumber, Jest, Vitest e Mocha.
No Cypress, use [`cy.task`](https://docs.cypress.io/api/commands/task) para executar o acesso ao banco no processo Node.
A biblioteca não depende desses frameworks e não deve ser importada no navegador.

- [Instalação](#instalação)
- [Início rápido](#início-rápido)
- [Métodos da biblioteca](#métodos-da-biblioteca)
- [Configuração por ambiente](#configuração-por-ambiente)
- [Múltiplas conexões e bases](#múltiplas-conexões-e-bases)
- [Pool, cache e erros](#pool-cache-e-erros)
- [Desenvolvimento e testes](#desenvolvimento-e-testes)

## Instalação

Use **Node.js 22 ou superior**. O pacote atende JavaScript e TypeScript,
com suporte a ESM (`import`), CommonJS (`require`) e declarações de tipos incluídas.

```bash
npm install --save-dev @mindqa/db-commons
```

Os drivers `pg`, `mssql`, `mysql2` e `oracledb` são
dependências do pacote; o consumidor não precisa instalá-los separadamente.
O Oracle usa o modo Thin, sem exigir instalação do Oracle Instant Client.
O framework de testes continua sendo uma dependência do projeto consumidor.

## Início rápido

No diretório a partir do qual você executa os testes, crie `.env`:

```dotenv
DB_DEFAULT_CONNECTION=postgresql
POSTGRESQL_HOST=localhost
POSTGRESQL_PORT=5432
POSTGRESQL_USER=qa_user
POSTGRESQL_PASS="sua_senha"
POSTGRESQL_NAME=qa_database
```

Esse arquivo é carregado automaticamente. Também é possível configurar
`SQLSERVER_*`, `MYSQL_*` e `ORACLE_*`. Com uma única conexão configurada,
`DB_DEFAULT_CONNECTION` pode ser omitido. Variáveis de ambiente têm prioridade
sobre as chaves do arquivo, inclusive quando seu valor está vazio.

O exemplo abaixo pressupõe um cliente já cadastrado. Coloque as instruções
dentro de uma função de teste `async`:

```javascript
import { DatabaseService } from '@mindqa/db-commons';
import assert from 'node:assert/strict';

const id = 'cliente-1';
const clientes = await DatabaseService.select(
  'SELECT nome, email FROM clientes WHERE id = ?',
  id,
);

assert.equal(clientes.length, 1);
assert.equal(clientes[0].nome, 'Cliente QA');
assert.equal(clientes[0].email, 'cliente@example.com');

const removidos = await DatabaseService.execute(
  'DELETE FROM clientes WHERE id = ?',
  id,
);
assert.equal(removidos, 1);
```

Em CommonJS, troque somente a importação:

```javascript
const { DatabaseService } = require('@mindqa/db-commons');
```

No TypeScript, você pode descrever as linhas retornadas:

```typescript
import { DatabaseService } from '@mindqa/db-commons';

interface Cliente {
  nome: string;
  email: string;
}

async function buscarClientes(id: string): Promise<Cliente[]> {
  return DatabaseService.select<Cliente>(
    'SELECT nome, email FROM clientes WHERE id = ?',
    id,
  );
}
```

O tipo genérico auxilia o compilador e o editor; não valida os dados do banco
em tempo de execução.

## Métodos da biblioteca

| Método                      | Retorno           | Uso                                                            |
| --------------------------- | ----------------- | -------------------------------------------------------------- |
| `select(sql, ...params)`    | `Promise<T[]>`    | Consulta; lista vazia quando não houver linhas.                |
| `execute(sql, ...params)`   | `Promise<number>` | INSERT, UPDATE ou DELETE; quantidade afetada, não o ID gerado. |
| `connection(nome)`          | `DatabaseClient`  | Seleciona uma conexão nomeada.                                 |
| `database(nome)`            | `DatabaseClient`  | Seleciona outra base da conexão padrão.                        |
| `clearConfigurationCache()` | `void`            | Invalida os snapshots de configuração.                         |
| `closePools()`              | `Promise<void>`   | Fecha os pools ao terminar a suíte.                            |

`connection()` e `database()` são síncronos: apenas criam clientes imutáveis,
sem abrir conexões ou ler arquivos. Os clientes podem ser reutilizados e
oferecem `select`, `execute` e `database`. Um nome de base nulo ou em branco
retoma a base configurada.

Use `?` para valores e passe os parâmetros diretamente após o SQL, na ordem:

```javascript
await DatabaseService.execute(
  'UPDATE clientes SET nome = ? WHERE id = ?',
  'Cliente QA',
  'cliente-1',
);
```

A biblioteca converte os placeholders para cada driver e envia os valores
separadamente. Não concatene dados no SQL. Parâmetros representam valores,
nunca nomes de tabelas, bases ou colunas. Caracteres `?` em textos, identificadores
delimitados e comentários não são substituídos. No PostgreSQL, escreva `??`,
`??|` e `??&` para os operadores JSON `?`, `?|` e `?&`.
Use somente placeholders `?`; não misture parâmetros nativos como `$1` ou `:nome`.

São aceitos `string`, números finitos (inteiros precisam ser seguros no JavaScript),
`boolean`, `bigint`, `Date`, `Buffer` e `null`. `undefined`, arrays e objetos
arbitrários são rejeitados; serialize JSON explicitamente quando necessário.
Use `null` para SQL NULL. No Oracle, booleanos são enviados como `1`/`0` e uma
string vazia segue a semântica NULL do banco.

O SQL e os tipos retornados seguem o banco/driver. Datas, decimais, inteiros grandes
e aliases podem ter representações diferentes; use aliases delimitados para
preservar maiúsculas/minúsculas, e strings/casts SQL quando precisar preservar
precisão decimal ou inteiros além de `Number.MAX_SAFE_INTEGER`.
LOBs Oracle de texto/binários são materializados antes de fechar a conexão.
Comentários executáveis MySQL (`/*! ... */`) não são suportados. O scanner assume
os modos de escape padrão: PostgreSQL `standard_conforming_strings=on` e MySQL
sem `NO_BACKSLASH_ESCAPES`.

## Configuração por ambiente

O arquivo é selecionado nesta ordem:

| Seleção no processo       | Arquivo lido                                                      |
| ------------------------- | ----------------------------------------------------------------- |
| `DB_CONFIG=config/qa.env` | Caminho explícito, relativo ao diretório de execução ou absoluto. |
| `DB_ENV=hml`              | `.env.hml` no diretório de execução.                              |
| Sem seletor               | `.env` no diretório de execução, se existir.                      |

Os arquivos **não são mesclados**. Com `DB_ENV=hml`, somente `.env.hml` é lido;
credenciais de `.env` não são usadas como fallback. Arquivos explicitamente
selecionados precisam existir. Sem seletor, a ausência de `.env` permite usar
somente variáveis de ambiente, como segredos do CI.

Defina `DB_CONFIG` e `DB_ENV` **antes de executar os testes**, nas variáveis do
processo, e não dentro do próprio arquivo a selecionar. `NODE_ENV` não seleciona
o banco. Um perfil aceita letras, números, hífen e sublinhado.

Linux/macOS:

```bash
DB_ENV=hml npm test
DB_CONFIG=config/qa.env npm test
```

PowerShell:

```powershell
$env:DB_ENV = 'hml'
npm test
```

A leitura segue a sintaxe `.env` do Node.js, com valores entre aspas e comentários.
Não expande `${VAR}` nem modifica `process.env`. Coloque senhas com `#` entre aspas.
Mantenha arquivos reais de credenciais fora do Git e versione somente exemplos.

Os sufixos abaixo podem usar `POSTGRESQL_`, `SQLSERVER_`, `MYSQL_`, `ORACLE_`,
um alias nomeado ou `DB_CONNECTIONS_<NOME>_`:

| Sufixo                       | Padrão / comportamento                                                                                                                                                        |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TYPE`                       | Inferido pelo prefixo; obrigatório na prática para conexões genéricas de outros bancos. Sem tipo, usa SQL Server, como no Java. Aceita `postgres` como alias de `postgresql`. |
| `HOST`                       | Obrigatório; host ou IP, sem protocolo, porta ou parâmetros.                                                                                                                  |
| `PORT`                       | 5432 PostgreSQL, 1433 SQL Server, 3306 MySQL, 1521 Oracle.                                                                                                                    |
| `USER`                       | Obrigatório.                                                                                                                                                                  |
| `PASS`                       | Obrigatório; aceita senha vazia e preserva espaços.                                                                                                                           |
| `NAME`                       | Obrigatório; nome da base ou service name no Oracle.                                                                                                                          |
| `LOGIN_TIMEOUT_SECONDS`      | `0`: não configura um limite adicional; preserva o comportamento padrão do driver.                                                                                            |
| `QUERY_TIMEOUT_SECONDS`      | `0`: sem limite de consulta configurado pela biblioteca.                                                                                                                      |
| `POOL_ENABLED`               | `false`.                                                                                                                                                                      |
| `POOL_MAX_SIZE`              | `5`.                                                                                                                                                                          |
| `POOL_CONNECTION_TIMEOUT_MS` | `30000`.                                                                                                                                                                      |
| `ENCRYPT`                    | SQL Server: `true`; aceita `true`, `false` ou `strict`.                                                                                                                       |
| `TRUST_SERVER_CERTIFICATE`   | SQL Server: `false`.                                                                                                                                                          |
| `DRIVER_OPTIONS`             | Objeto JSON com as opções adicionais permitidas abaixo.                                                                                                                       |

Também é possível usar uma única conexão na raiz com `DB_TYPE`, `DB_HOST`,
`DB_PORT`, `DB_USER`, `DB_PASS` e `DB_NAME`. Chaves na raiz não são herdadas
por conexões nomeadas. `DB_DEFAULT_CONNECTION` e `DB_CONFIG_CACHE_ENABLED`
são globais, sem prefixo do banco.

Os limites de tempo acompanham os drivers: PostgreSQL usa `statement_timeout`,
SQL Server usa `requestTimeout`, MySQL usa timeout do comando e descarta a
conexão em caso de falha, e Oracle usa `callTimeout` por round trip, não por
consulta inteira. Uma alteração pode ter sido confirmada pelo banco antes de
uma falha de rede/timeout; a biblioteca não repete operações automaticamente.

Opções adicionais de `DRIVER_OPTIONS`:

| Banco      | Chaves permitidas                                                                                      |
| ---------- | ------------------------------------------------------------------------------------------------------ |
| PostgreSQL | `application_name`, `ssl`, `keepAlive`                                                                 |
| SQL Server | `appName`, `useUTC`, `enableArithAbort`                                                                |
| MySQL      | `charset`, `timezone`, `supportBigNumbers`, `bigNumberStrings`, `decimalNumbers`, `dateStrings`, `ssl` |
| Oracle     | `stmtCacheSize`                                                                                        |

`ssl` aceita booleano ou objeto com `ca`, `cert`, `key` (conteúdo PEM) e
`rejectUnauthorized` (booleano). As demais opções mantêm os tipos do driver.
Destino, credenciais e limites não podem ser substituídos por opções genéricas.

```dotenv
POSTGRESQL_DRIVER_OPTIONS='{"application_name":"qa-tests","ssl":{"rejectUnauthorized":true}}'
```

As propriedades JDBC `DB_DRIVER_PROPERTIES` não são transferíveis para drivers
Node.js; use `DRIVER_OPTIONS`. Para SQL Server local com certificado autoassinado,
configure `SQLSERVER_TRUST_SERVER_CERTIFICATE=true` somente no ambiente correspondente.

## Múltiplas conexões e bases

Use aliases para dois destinos do mesmo banco:

```dotenv
DB_DEFAULT_CONNECTION=principal

POSTGRESQL_PRINCIPAL_HOST=localhost
POSTGRESQL_PRINCIPAL_PORT=5432
POSTGRESQL_PRINCIPAL_USER=qa_user
POSTGRESQL_PRINCIPAL_PASS="sua_senha"
POSTGRESQL_PRINCIPAL_NAME=qa_clientes

POSTGRESQL_FINANCEIRO_HOST=localhost
POSTGRESQL_FINANCEIRO_PORT=5433
POSTGRESQL_FINANCEIRO_USER=financeiro_user
POSTGRESQL_FINANCEIRO_PASS="outra_senha"
POSTGRESQL_FINANCEIRO_NAME=qa_financeiro
```

```javascript
const auditoria = await DatabaseService.database('qa_auditoria').select(
  'SELECT nome FROM clientes WHERE id = ?',
  'cliente-1',
);

const financeiro = DatabaseService.connection('financeiro');
const removidos = await financeiro
  .database('qa_clientes')
  .execute('DELETE FROM clientes WHERE id = ?', 'cliente-1');
```

As bases precisam existir e o usuário precisa ter acesso. `database()` preserva
host, porta, credenciais e opções; no Oracle, troca o service name, não o schema.

A forma genérica também é aceita: `DB_CONNECTIONS_FINANCEIRO_TYPE=postgresql`,
`DB_CONNECTIONS_FINANCEIRO_HOST=...` etc. Dentro de uma mesma fonte, essa forma
tem prioridade sobre aliases; entre fontes, o ambiente tem prioridade sobre
o arquivo. Não configure o mesmo nome com prefixos de bancos diferentes.

Nomes usam letras ASCII e números, começando por letra. A seleção ignora
maiúsculas e espaços nas extremidades. Um nome desconhecido gera erro; várias
conexões sem uma conexão padrão geram erro de ambiguidade. Apenas o destino selecionado
é validado.

## Pool, cache e erros

Sem pool, cada operação abre e fecha seus recursos. No SQL Server, o driver
usa internamente um pool de uma conexão, também fechado após a operação.
Para reutilizar conexões físicas, habilite por destino:

```dotenv
POSTGRESQL_POOL_ENABLED=true
POSTGRESQL_POOL_MAX_SIZE=5
POSTGRESQL_POOL_CONNECTION_TIMEOUT_MS=30000
DB_CONFIG_CACHE_ENABLED=true
```

Cada operação continua isolada em sua conexão enquanto estiver executando.
Não há transação compartilhada entre chamadas. Alterações de sessão via SQL não
são restauradas automaticamente; mantenha esse tipo de operação fora de pools
reutilizados. O cache de configuração é independente do pool.

```javascript
// Após alterar o arquivo com cache habilitado:
DatabaseService.clearConfigurationCache();

// No encerramento da suíte, depois de aguardar as consultas:
await DatabaseService.closePools();
```

O registro mantém até 32 pools por processo, separados por destino, credenciais
e opções. Destinos adicionais usam conexões diretas. O cache mantém até 32 snapshots.
Workers distintos têm registros próprios. O carregamento via ESM e CommonJS no
mesmo processo compartilha os registros. A biblioteca não instala handlers de
sinais nem encerra o processo; o consumidor deve aguardar `closePools()` no teardown.

Argumentos inválidos geram `TypeError`; problemas de configuração geram
`DatabaseConfigurationError`; falhas de driver geram `DatabaseError` com o erro
original em `cause`. A mensagem externa não acrescenta SQL, parâmetros ou
credenciais. A causa pode conter informações do driver; evite publicá-la em logs
sem revisão. Falhas simultâneas de operação e fechamento são preservadas em um
`AggregateError` na causa.

## Desenvolvimento e testes

```bash
npm ci
npm run check
```

O comando verifica tipos, lint, formatação, testes unitários, build e consumo do
tarball em JavaScript e TypeScript, ESM e CommonJS. Os testes unitários não exigem
um servidor de banco. O teste de empacotamento instala o tarball em um projeto
temporário, aproveita o cache do npm e pode consultar o registro para resolver dependências.

Para testes de integração com os quatro bancos isolados em Docker:

```bash
docker compose -f compose.integration.yml up -d --wait postgresql mysql sqlserver oracle
docker compose -f compose.integration.yml run --rm sqlserver-init
DB_CONFIG=.env.integration.example npm run test:integration
docker compose -f compose.integration.yml down --volumes
```

Os testes criam e removem somente tabelas com nomes aleatórios `mindqa_*`.
O arquivo de exemplo usa credenciais descartáveis e portas locais exclusivas.
Para um banco de cada vez, adicione `IT_DATABASE=postgresql` (ou `sqlserver`,
`mysql`, `oracle`). A CI executa testes unitários em Node.js 22/24 e integração
com os quatro bancos.

Para gerar o pacote localmente, sem publicar:

```bash
npm pack
```

O tarball inclui somente `dist`, README, licença e metadados do pacote.
A documentação de arquitetura está em [docs/architecture.md](docs/architecture.md).

## Como contribuir

Consulte [CONTRIBUTING.md](CONTRIBUTING.md). Alterações de comportamento devem
incluir testes. Questões de segurança seguem [SECURITY.md](SECURITY.md).

## Licença

Distribuído sob a [licença MIT](LICENSE).
