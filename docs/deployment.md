# Preparação para publicar a HIKARI IMPORTADOS

Este guia descreve os requisitos de publicação; sua presença no repositório não
significa que exista um ambiente publicado. O domínio `hikariimportados.com` foi
autenticado na Brevo e a recuperação de senha foi validada no ambiente local.
A publicação HTTPS e a emissão fiscal continuam pendentes. É possível testar a
hospedagem com uma URL HTTPS temporária antes de conectar o domínio da loja.

O roteiro e o estado da homologação estão em [homologation.md](homologation.md).

## Topologia de frontend e API

O frontend é estático (pasta `dist` do projeto `jornadatcg-web`). A API precisa de
um serviço Node.js 24 sempre ativo, com acesso ao PostgreSQL. Os workers de
expiração de pedidos e sincronização de etiquetas executam dentro desse processo.
Comece com uma instância da API; o rate limit atual usa memória local.

Use preferencialmente uma única origem HTTPS para o navegador:

```text
https://URL-DO-SITE/        -> arquivos estáticos do frontend
https://URL-DO-SITE/api/*   -> proxy para a API, removendo o prefixo /api
```

O refresh token tem cookie HttpOnly, Secure em produção, SameSite=Strict e caminho
`/auth`. No proxy, reescreva o caminho do cookie de `/auth` para `/api/auth`, como
o proxy local do Vite já faz. Preserve os headers Origin e X-Requested-With e não
armazene respostas de autenticação em cache. Restrinja o acesso direto à API ao
proxy conforme os recursos da hospedagem escolhida.

Outra opção é site e API em subdomínios HTTPS do mesmo domínio, com CORS exato e
`VITE_API_BASE_URL` apontando para a API. Site e API em domínios temporários de
provedores diferentes são cross-site: o cookie Strict e a proteção de origem
podem impedir a renovação de sessão. A solução preferida é proxy na mesma origem;
não remova essas proteções para contornar a topologia.

## API

No ambiente de build, instale também as dependências de desenvolvimento, pois
Prisma CLI e Nest CLI são necessários:

```sh
npm ci
npm run build:deploy
```

`build:deploy` gera o Prisma Client pelo schema e compila TypeScript. A geração
precisa de `DATABASE_URL` para carregar a configuração, mas não conecta ao banco.
O build não aplica migrations. Não dependa de arquivos de `src/generated/prisma`
presentes na máquina de desenvolvimento: essa pasta não é versionada.

Depois de configurar os segredos na hospedagem e antes de disponibilizar a nova
versão, execute uma vez o passo de release com as dependências de build instaladas:

```sh
npm run migrate:deploy
```

Esse passo modifica o banco de destino. Confira qual ambiente está selecionado,
tenha backup e siga as instruções de parada dos workers para as migrations de
histórico/entrada de estoque. Não execute reset, db push ou seed de teste em
produção. Na primeira publicação, confirme que todas as migrations necessárias
estão aplicadas. O CI de checks não recebe credenciais reais nem aplica migrations.

Inicie a aplicação compilada:

```sh
npm run start:prod
```

Configure no serviço da API:

- `NODE_ENV=production`;
- `PORT`: porta TCP fornecida pela hospedagem (inteiro de 1 a 65535);
- `DATABASE_URL`: conexão privada PostgreSQL da API;
- `JWT_SECRET`: segredo aleatório com pelo menos 32 bytes;
- `AUTH_ALLOWED_ORIGINS`: origem HTTPS exata do frontend, sem barra final, caminho
  ou curingas. Múltiplas origens são separadas por vírgula.

Configurações inválidas de runtime impedem o início com mensagens sem os valores
informados. Em produção, URL do banco, segredo e pelo menos uma origem são exigidos.
As configurações e chaves ficam no gerenciador de segredos da hospedagem, não no Git.

Para uma demonstração, mantenha Asaas e Melhor Envio em sandbox. Não reutilize
chaves sandbox como chaves de produção. A API pode iniciar sem SMTP e sem a chave
Pokémon; as funções que dependem dessas integrações continuarão indisponíveis.
E-mail em produção também exige `PASSWORD_RESET_URL` na origem correta do site.
As demais variáveis específicas de cada integração estão no `.env.example`.

## Saúde e encerramento

- `GET /health`: liveness; devolve `{"status":"ok"}` sem consultar o banco.
- `GET /health/ready`: consulta somente `SELECT 1` no PostgreSQL. Retorna 200 com
  `{"status":"ok","database":"up"}` ou 503 com mensagem genérica. A transação
  limita aquisição de conexão a 1 s e execução a 2 s; transporte/driver podem
  influenciar o tempo observado. Use esta rota como readiness da hospedagem.
- Ambos usam `Cache-Control: no-store`, não exigem login e não retornam detalhes
  da conexão. Readiness não verifica migrations ou serviços externos.

O bootstrap habilita os hooks de encerramento do Nest para sinais suportados pelo
sistema, permitindo finalizar workers e fechar o Prisma. Reserve tempo de
encerramento suficiente na hospedagem para operações em andamento.

## Frontend

Na hospedagem do repositório `jornadatcg-web`:

```sh
npm ci
npm run build
```

Publicar a pasta `dist` com HTTPS. Para a topologia com proxy, configure
`VITE_API_BASE_URL=/api` no build. Essas variáveis são públicas e embutidas no JS;
nunca use prefixo `VITE_` para segredos. O proxy do Vite funciona apenas no
desenvolvimento; a hospedagem precisa configurar seu próprio proxy/rewrite.
`vite preview` é uma ferramenta de conferência local, não o servidor de produção.

## Checks e validação após a publicação

Os dois repositórios têm workflow `ci.yml` com Node 24, instalação pelo lockfile,
build, lint e testes, sem acesso a banco/serviços reais. Os workflows só executarão
no GitHub depois que os arquivos forem enviados. Eles verificam o código e não
fazem deploy.

Com a URL de homologação pronta, validar no navegador: catálogo e imagens,
login e renovação de sessão após recarregar, carrinho, pedido e Pix sandbox,
compras acumuladas, solicitação e pagamento separado de frete, painel gestor e
histórico de estoque. O checkout de etiqueta consome saldo do provedor; em testes,
confira explicitamente o ambiente sandbox e os valores antes de confirmar.
Configure o webhook Asaas com a URL HTTPS pública correspondente à topologia
(`/api/webhooks/asaas` com proxy) e um token próprio.

Revalidar SMTP, links de recuperação e API Pokémon na hospedagem, mesmo que já
tenham funcionado localmente. Registrar emissão fiscal como adiada e registrar
separadamente qualquer integração não configurada. Uma resposta 200 de saúde não
substitui esse teste completo.
