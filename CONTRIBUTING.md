# Como contribuir

Use Node.js 22+ e npm. Instale com `npm ci` e execute `npm run check`.
Formate alterações com `npm run format`. Mudanças no contrato, configuração,
SQL ou drivers devem incluir testes de comportamento; para drivers, execute
também os testes de integração descritos no README.

Mantenha a API pequena e independente de frameworks. Não registre credenciais,
SQL ou parâmetros em logs. Evite estado global dos drivers, dependências do
framework consumidor e alterações no `process.env` dentro da biblioteca.

Use nomes de código em inglês e documentação de uso em português. Preserve o
lockfile e a compatibilidade ESM/CommonJS. A versão pública está no `package.json`;
o projeto Node.js possui versionamento independente da biblioteca Java.

Antes de publicar, execute os checks e a integração nos quatro bancos, revise
`npm pack --dry-run` e publique com a conta responsável pelo escopo `@mindqa`.
A criação de um commit ou tag não publica o pacote automaticamente.
