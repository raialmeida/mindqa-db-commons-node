# Segurança

Não publique credenciais ou dados sensíveis em issues. Para relatar uma
vulnerabilidade, use o canal privado de reporte do GitHub, quando habilitado,
ou entre em contato com o mantenedor para combinar um canal privado.

Use parâmetros SQL para valores e usuários de banco com as permissões necessárias
para os testes. Guarde credenciais em variáveis de ambiente/segredos do CI ou
arquivos locais fora do Git. Consulte o README para configuração de TLS e
restrições das opções dos drivers.

O pacote não registra consultas ou credenciais. O erro original do driver fica
em `cause`; revise seu conteúdo antes de compartilhá-lo em logs públicos.
