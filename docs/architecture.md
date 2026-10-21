# Arquitetura

## Contrato e responsabilidades

`DatabaseService` é uma fachada sobre `DatabaseClient`. Os clientes guardam
somente os nomes da conexão e da base; são imutáveis e reutilizáveis.
A biblioteca executa SQL parametrizado em auto-commit, sem ORM, migrações ou
transações compartilhadas. Cada chamada adquire sua própria conexão.

```text
DatabaseService → DatabaseClient
                    ├── loadConfiguration → Configuration → ConnectionSettings
                    ├── bindPlaceholders
                    └── withDriver → DatabaseDriver → driver Node.js

createDatabaseTasks → valida entrada do cy.task()
                    └── DatabaseService ou DatabaseClient
```

- `configuration`: seleciona `.env`, captura o ambiente sem modificá-lo, resolve
  namespaces e valida campos. Um destino nunca herda credenciais de outro.
- `sql`: valida valores e converte placeholders por um scanner sensível ao dialeto.
  Nenhum valor é interpolado no SQL. O scanner preserva literais, identificadores
  e comentários conforme as regras implementadas para cada dialeto.
- `drivers`: adaptadores com `select`, `execute` e `close`; contêm diferenças de
  parâmetros, retorno, timeout e gerenciamento de recursos dos quatro drivers.
- `internal`: ciclo de vida de recursos, registro limitado de pools e fingerprints
  HMAC para evitar credenciais legíveis nas chaves internas.
- `errors`: configuração e falhas de driver têm classes públicas próprias.
- `cypress`: valida dados recebidos por `cy.task()`, seleciona conexão e base e
  converte a cadeia de erros em uma mensagem serializável pelo Cypress.

O ponto de entrada `@mindqa/db-commons` exporta a fachada, o cliente, erros e
tipos de consumo. `@mindqa/db-commons/cypress` exporta `createDatabaseTasks` e
os tipos do adaptador. Tipos internos de configuração e driver não fazem parte
da API pública.

No adaptador Cypress, SQL e parâmetros atravessam o `cy.task()`, enquanto as
credenciais permanecem no processo Node. Os parâmetros são limitados a valores
serializáveis. Falhas preservam o erro original em `cause` e também expõem sua
descrição na mensagem apresentada pelo Cypress, sem acrescentar SQL, parâmetros
ou credenciais.

## Configuração e concorrência

A leitura de arquivo é assíncrona. Cada operação captura um snapshot das
variáveis relevantes antes de ler o arquivo. Com cache, a chave inclui caminho
absoluto e snapshot de ambiente. A invalidação usa uma geração para impedir que
uma leitura antiga repovoe o cache após `clearConfigurationCache()`.
O cache é LRU de até 32 entradas, independente dos pools.

Pools são indexados por todos os valores de conexão, inclusive credenciais,
base e opções. Uma Promise registrada antes de aguardar a criação impede pools
duplicados quando chamadas concorrentes usam o mesmo destino. Uma criação que
falha sai do registro para permitir nova tentativa posterior. O limite é de 32
pools; conexões excedentes usam o modo direto para não fechar recursos em uso.

`closePools()` deve ser chamado após concluir as operações. Ele tenta fechar
todos os pools, agrega falhas e permite recriação posterior. Novas operações
aguardam o fechamento em andamento. Não há handlers globais de sinais.

ESM reexporta a implementação CommonJS gerada para evitar dois registros de
pool/cache quando um projeto usa os dois formatos. Tipagens distintas `.d.ts` e
`.d.cts` preservam a resolução de módulos TypeScript. Um teste instala o tarball
e verifica ambos os formatos fora da árvore de fontes.

## Recursos e diferenças de drivers

PostgreSQL usa `pg.Client` no modo direto e `pg.Pool` com pool. MySQL usa
conexões/prepared statements de `mysql2/promise`. SQL Server usa um
`ConnectionPool` próprio por destino; no modo direto ele dura uma única operação.
Oracle usa conexões/pools de `oracledb`, com auto-commit explícito e LOBs
materializados antes do fechamento.

O helper `usingResource` libera o recurso em sucesso ou falha e preserva erros
simultâneos por `AggregateError`. Aquisições tardias após timeout são descartadas.
Falhas MySQL descartam a conexão; falhas PostgreSQL removem o cliente do pool.
Nenhuma operação é repetida automaticamente, evitando duplicação de DML.

Opções específicas são permitidas por listas e tipos explícitos. Elas não
podem sobrescrever destino, credenciais, parâmetros, múltiplas instruções ou
políticas de timeout. A configuração SQL Server inicia com TLS habilitado e
verificação do certificado. É uma escolha deliberada mais restritiva que o
padrão de criptografia da referência Java 4.0.1.

## Validação

Testes unitários cobrem precedência, perfis, isolamento, validação de tipos,
scanner SQL, falhas, concorrência de inicialização dos pools e tarefas Cypress.
Os testes do adaptador verificam entrada, seleção de conexão e base, causas
circulares e erros agregados. Testes de integração usam a distribuição compilada,
drivers reais e bancos em Docker, com pool habilitado ou desabilitado, CRUD,
valores especiais, concorrência, seleção de base e recuperação de erros. O
consumidor continua responsável pelo dialeto SQL e por representações de tipos
que variam entre bancos, como decimais, datas e inteiros grandes.
