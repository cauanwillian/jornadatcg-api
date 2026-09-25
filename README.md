<p align="center">
  <a href="http://nestjs.com/" target="blank"><img src="https://nestjs.com/img/logo-small.svg" width="120" alt="Nest Logo" /></a>
</p>

[circleci-image]: https://img.shields.io/circleci/build/github/nestjs/nest/master?token=abc123def456
[circleci-url]: https://circleci.com/gh/nestjs/nest

  <p align="center">A progressive <a href="http://nodejs.org" target="_blank">Node.js</a> framework for building efficient and scalable server-side applications.</p>
    <p align="center">
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/v/@nestjs/core.svg" alt="NPM Version" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/l/@nestjs/core.svg" alt="Package License" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/dm/@nestjs/common.svg" alt="NPM Downloads" /></a>
<a href="https://circleci.com/gh/nestjs/nest" target="_blank"><img src="https://img.shields.io/circleci/build/github/nestjs/nest/master" alt="CircleCI" /></a>
<a href="https://discord.gg/G7Qnnhy" target="_blank"><img src="https://img.shields.io/badge/discord-online-brightgreen.svg" alt="Discord"/></a>
<a href="https://opencollective.com/nest#backer" target="_blank"><img src="https://opencollective.com/nest/backers/badge.svg" alt="Backers on Open Collective" /></a>
<a href="https://opencollective.com/nest#sponsor" target="_blank"><img src="https://opencollective.com/nest/sponsors/badge.svg" alt="Sponsors on Open Collective" /></a>
  <a href="https://paypal.me/kamilmysliwiec" target="_blank"><img src="https://img.shields.io/badge/Donate-PayPal-ff3f59.svg" alt="Donate us"/></a>
    <a href="https://opencollective.com/nest#sponsor"  target="_blank"><img src="https://img.shields.io/badge/Support%20us-Open%20Collective-41B883.svg" alt="Support us"></a>
  <a href="https://twitter.com/nestframework" target="_blank"><img src="https://img.shields.io/twitter/follow/nestframework.svg?style=social&label=Follow" alt="Follow us on Twitter"></a>
</p>
  <!--[![Backers on Open Collective](https://opencollective.com/nest/backers/badge.svg)](https://opencollective.com/nest#backer)
  [![Sponsors on Open Collective](https://opencollective.com/nest/sponsors/badge.svg)](https://opencollective.com/nest#sponsor)-->

## Description

[Nest](https://github.com/nestjs/nest) framework TypeScript starter repository.

## Project setup

```bash
$ npm install
```

## Compile and run the project

```bash
# development
$ npm run start

# watch mode
$ npm run start:dev

# production mode
$ npm run start:prod
```

## Pesquisa de cartas Pokémon

Execute `npm run start:dev` e consulte:

- `GET http://localhost:3000/cards/search?name=Pikachu`
- `GET http://localhost:3000/cards/search?code=025/182`
- `GET http://localhost:3000/cards/search?name=Pikachu&code=025/182`

Pelo menos um parâmetro é obrigatório. Quando ambos são enviados, os filtros
são combinados. Parâmetros vazios, repetidos ou códigos fora do formato
`número/número` retornam HTTP 400. O total deve ser positivo; o número pode
exceder o total impresso (cartas secretas).

A busca por código consulta `expansion.printed_total` no Scrydex e compara numericamente o
`number` das cartas retornadas: `025` e `25` são equivalentes. Todas as páginas
externas são consultadas dentro de um prazo total de 10 segundos. Essa estratégia
evita depender da indexação de zeros à esquerda, mas pode exigir mais requisições
em coleções com o mesmo total. Uma falha interrompe a busca sem retornar dados
parciais. Cada página externa contém até 100 cartas. As requisições não incluem
preços ou relatórios adicionais.

A resposta é uma lista com `externalId`, `name`, `number`, `set` (`externalId`,
`name`, `printedTotal`), `rarity`, `artist` e `images` (`small`, `large`). O número
mantém a representação original do provedor; campos opcionais ausentes são `null`.
Nenhum resultado retorna `[]` com HTTP 200. Falhas externas retornam mensagens
sanitizadas: 502 para resposta inválida, 503 para indisponibilidade/limite de
requisições/autenticação externa e 504 para timeout.

Configure `SCRYDEX_API_KEY` e `SCRYDEX_TEAM_ID` no `.env` (carregado no bootstrap).
São enviados somente nos headers `X-Api-Key` e `X-Team-ID`. Sem os dois valores,
pesquisa e importação retornam 503 sem chamar o provedor; a consulta ao catálogo
local continua disponível. A variável antiga `POKEMON_TCG_API_KEY` não é usada.
Não versione credenciais.

Para obter as credenciais, [crie sua conta Scrydex](https://scrydex.com/register),
selecione um plano, crie uma equipe e gere a API key no Account Hub. Copie o Team
ID e a chave para o `.env` e reinicie `npm run start:dev`.
Veja a [documentação de autenticação](https://scrydex.com/docs/getting-started/authentication).

```env
SCRYDEX_API_KEY=
SCRYDEX_TEAM_ID=
```

O adapter `src/modules/cards/integrations/scrydex.service.ts` converte `expansion`
para `set`, `printed_total` para `printedTotal` e seleciona a imagem de tipo
`front` da lista `images`. Imagens frontais ausentes resultam em URLs `null`.
Os endpoints do backend e o formato normalizado permanecem os mesmos. Os IDs
externos agora vêm do Scrydex; dados já persistidos não são reescritos pela troca
do provedor. Nenhuma migration é necessária.

A rota de pesquisa externa não acessa nem persiste dados no banco. Os testes em
`src/modules/cards/cards.spec.ts` exercitam o endpoint HTTP com `fetch` simulado,
sem rede ou banco, e são executados por `npm test`.

## Autenticação e acesso administrativo

A autenticação usa o modelo `User` existente, via Prisma. Não depende de Scrydex
nem de Supabase Auth e não requer uma migration.

Configure `JWT_SECRET` no `.env` com um segredo aleatório de pelo menos 32 bytes.
Para gerar um valor e copiá-lo apenas para seu `.env`:

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

```env
JWT_SECRET=cole_o_segredo_gerado_aqui
```

Reinicie o servidor. Sem configuração válida, cadastro e login retornam 503.
Nunca envie esse segredo ao frontend: o cliente utiliza o `accessToken` retornado
pelo login. `CARDS_IMPORT_TOKEN` foi removido e pode ser apagado do `.env`.

### Cadastro, login e perfil

`POST /auth/register` cria somente usuários CUSTOMER e retorna HTTP 201 com
`id`, `name`, `email` e `role`:

```json
{
  "name": "Seu Nome",
  "email": "voce@example.com",
  "password": "substitua-por-uma-senha-forte"
}
```

O email é normalizado para minúsculas e sem espaços nas extremidades. A senha
deve ter de 12 a 128 caracteres, é preservada como enviada e armazenada somente
como hash scrypt com salt aleatório (`N=131072`, `r=8`, `p=1`). Campos extras,
inclusive `role` e `passwordHash`, são rejeitados. Email duplicado retorna 409.

`POST /auth/login` recebe `email` e `password`. Retorna HTTP 200 com:

```json
{
  "accessToken": "JWT-gerado-pelo-servidor",
  "tokenType": "Bearer",
  "expiresIn": 900,
  "user": { "id": "UUID", "name": "Seu Nome", "email": "voce@example.com", "role": "CUSTOMER" }
}
```

`GET /auth/me` exige `Authorization: Bearer <accessToken>` e retorna o perfil
atual. Senhas e hashes nunca fazem parte das respostas. Login incorreto retorna
401 com a mesma mensagem para email inexistente e senha incorreta.

O JWT usa HS256, issuer `jornadatcg-api`, audience `jornadatcg` e validade de
15 minutos. A assinatura, expiração e claims são verificadas. O usuário e seu
papel são consultados no banco a cada acesso protegido, portanto a remoção da
conta ou perda do papel ADMIN passa a valer para tokens já emitidos.

Cadastro aceita 5 requisições/minuto por IP; login aceita 10, retornando 429 e
`Retry-After` ao exceder o limite. Os contadores ficam na memória de cada processo;
antes de executar múltiplas instâncias, configure armazenamento compartilhado.
Atrás de um proxy, configure a confiança apenas nos proxies conhecidos para
identificar corretamente o IP do cliente.

Esta etapa não inclui confirmação de email, recuperação de senha, refresh token
ou revogação individual de sessão. Após 15 minutos, faça login novamente. No
logout do cliente, descarte o token; ele permanece válido até expirar. Use HTTPS
fora do ambiente local.

### Primeiro administrador

1. Cadastre sua própria conta em `/auth/register`.
2. Execute localmente, com o banco configurado no `.env`:

```bash
npm run build
npm run admin:promote -- --email voce@example.com
```

Esse comando promove somente uma conta existente. Não cria uma senha, não cria
usuários e não possui endpoint HTTP. Não é executado automaticamente no startup.

3. Faça login e utilize o `accessToken` para as operações administrativas.

Exemplo no PowerShell (substitua os valores de exemplo):

```powershell
$loginBody = @{ email = 'voce@example.com'; password = 'sua-senha' } | ConvertTo-Json
$login = Invoke-RestMethod -Method Post -Uri 'http://localhost:3000/auth/login' `
  -ContentType 'application/json' -Body $loginBody
$authHeaders = @{ Authorization = "Bearer $($login.accessToken)" }
Invoke-RestMethod -Uri 'http://localhost:3000/auth/me' -Headers $authHeaders
```

## Catálogo local: importação e consulta

O catálogo usa os modelos existentes `CardSet` e `Card`. Não é necessário aplicar
uma nova migration. Product e Inventory não participam deste fluxo.

### Importar uma carta

`POST /cards/import` recebe somente o identificador obtido em `/cards/search`:

```json
{ "externalId": "base1-58" }
```

O backend consulta `GET /pokemon/v1/cards/{externalId}` no Scrydex e valida o
resultado antes de abrir uma transação. Coleção e carta são persistidas juntas;
uma falha desfaz toda a transação. A coleção é reutilizada pelo `externalId`.
Importar novamente a mesma carta retorna o cadastro existente sem sobrescrevê-lo.
Tanto a primeira importação quanto as repetições retornam HTTP 200 e o objeto da
carta local. A API externa é consultada também nas repetições.

Conflitos de concorrência têm até três tentativas de transação. Se outro
identificador externo ocupar o mesmo par coleção/número, a rota retorna 409.
A representação do número do provedor é preservada. Campos opcionais de coleção
são mapeados quando presentes no objeto `expansion`: `code`, `logo`/`symbol` →
`logoUrl`/`symbolUrl` e `release_date` → data. Campos opcionais ausentes ficam
`null`; não é feita uma requisição extra para enriquecer a coleção.
Dados brutos, preços externos e `metadata` não são importados.

**Acesso administrativo:** a importação exige JWT válido e usuário com papel
ADMIN no banco. Token ausente, inválido ou expirado retorna 401; usuário CUSTOMER
recebe 403. O token estático antigo não é mais aceito. Use os headers obtidos
no exemplo de login acima:

```powershell
Invoke-RestMethod -Method Post -Uri 'http://localhost:3000/cards/import' `
  -Headers $authHeaders `
  -ContentType 'application/json' `
  -Body '{ "externalId": "base1-58" }'
```

### Listar e consultar cartas cadastradas

- `GET http://localhost:3000/cards`
- `GET http://localhost:3000/cards?name=Pikachu&page=1&limit=20`
- `GET http://localhost:3000/cards?setId=<UUID-da-colecao>&page=1&limit=20`
- `GET http://localhost:3000/cards/<UUID-da-carta>`

Essas rotas consultam somente o banco local e são públicas. O parâmetro `name`
faz uma busca parcial sem diferenciar maiúsculas/minúsculas; `%` e `_` são
tratados como texto literal. `setId` usa o UUID local, não o identificador externo.
`page` aceita 1 a 10000 (padrão 1) e `limit` aceita 1 a 100 (padrão 20).
A ordenação é por nome e UUID para estabilizar a paginação. A lista e o total
são lidos na mesma transação com isolamento Repeatable Read.

Formato da listagem:

```json
{
  "data": [],
  "pagination": { "page": 1, "limit": 20, "total": 0, "totalPages": 0 }
}
```

Cada carta inclui os campos normalizados da busca externa, além do `id` local,
`createdAt`, `updatedAt` e detalhes da coleção (`id`, `series`, `code`, `total`,
`releaseDate`, `logoUrl`, `symbolUrl`). `set.printedTotal` pode ser `null` em
registros locais preexistentes. Datas de lançamento usam `YYYY-MM-DD` e timestamps
usam ISO 8601. Coleções existentes não são sobrescritas durante a importação.

UUID ou parâmetros inválidos retornam 400. Carta ausente localmente ou no provedor
retorna 404. Erros de banco são sanitizados como 503; erros externos preservam o
tratamento 502/503/504 da pesquisa. Os testes do catálogo em
`src/modules/cards/cards-catalog.spec.ts` usam mocks de Prisma e HTTP, cobrindo
validação, autorização, mapeamento, idempotência, conflitos e paginação.

## Produtos e estoque (administração)

Todas as rotas `/products` exigem `Authorization: Bearer <accessToken>` de um
usuário ADMIN. Sem token válido, retornam 401; para CUSTOMER, 403. Essas rotas são
para o painel administrativo e incluem dados de estoque reservado/vendido e
produtos inativos. Uma vitrine pública poderá ter um contrato separado depois.
Não há novas variáveis de ambiente nem migrations nesta etapa.

### Categorias, condições e idiomas

Cadastre as opções usando POST com JSON e o token de administrador:

| Endpoint | Exemplo de corpo |
| --- | --- |
| `/products/categories` | `{"name":"Singles","slug":"singles"}` |
| `/products/conditions` | `{"name":"Near Mint","code":"NM"}` |
| `/products/languages` | `{"name":"Português","code":"PT-BR"}` |

Categoria e condição também aceitam `description` opcional (até 2000 caracteres
ou `null`). Os cadastros nascem ativos. Slugs são normalizados para minúsculas e
códigos para maiúsculas. Duplicatas das chaves únicas existentes retornam 409.
`GET /products/options` retorna `{ categories, conditions, languages }` com as
opções ativas e seus UUIDs. Os dados são cadastrados explicitamente; não há seed
automático.

### Criar um produto

`POST /products` recebe os UUIDs locais da carta e das opções:

```json
{
  "cardId": "UUID-da-carta",
  "conditionId": "UUID-da-condicao",
  "languageId": "UUID-do-idioma",
  "categoryId": "UUID-da-categoria",
  "price": "25.90",
  "availableQuantity": 5,
  "observation": "Carta avulsa",
  "active": true
}
```

O cadastro retorna 201 com o produto, carta, opções e estoque. Produto e estoque
são criados na mesma transação. A carta precisa existir no catálogo local, e as
opções precisam existir e estar ativas. Referências inválidas retornam 400.
Sem `availableQuantity`, a quantidade inicial é zero; sem `active`, o produto
nasce ativo. Quantidades reservadas e vendidas começam em zero.

O preço é obrigatoriamente uma **string decimal positiva**, de `"0.01"` até
`"9999999999.99"`, com no máximo duas casas decimais e ponto como separador.
Valores JSON numéricos, vírgulas e notação científica são rejeitados. O banco usa
Decimal e a resposta sempre traz duas casas, como `"25.90"`.

Sem o Scrydex configurado, é possível cadastrar opções e testar autenticação e
listagem. Criar um produto exige uma carta já cadastrada; a importação de novas
cartas continua dependendo do acesso ao Scrydex.

### Listar, consultar e editar

- `GET /products?page=1&limit=20`
- `GET /products?name=Pikachu&active=true`
- `GET /products?cardId=<UUID-da-carta>`
- `GET /products/<UUID-do-produto>`
- `PATCH /products/<UUID-do-produto>`

A listagem retorna `{ data, pagination: { page, limit, total, totalPages } }`.
`page` aceita 1 a 10000; `limit`, 1 a 100 (padrão 20). O nome filtra a carta
parcialmente, sem diferenciar maiúsculas/minúsculas. Sem filtro `active`, a
listagem administrativa inclui ativos e inativos. A ordem é por criação
decrescente e UUID. Os totais e a página usam a mesma transação de leitura.

O PATCH aceita os campos de cadastro, exceto `availableQuantity`. Informe ao
menos um campo; referências alteradas são revalidadas. Exemplo para desativar:

```json
{ "active": false }
```

`observation` aceita até 2000 caracteres e pode ser removida com `null`.
Não há exclusão física. A modelagem atual permite mais de um produto para a mesma
carta/condição/idioma/categoria; não foi adicionada uma regra de unicidade nova.

### Ajustar a quantidade disponível

`PATCH /products/<UUID-do-produto>/inventory`:

```json
{ "expectedAvailableQuantity": 5, "availableQuantity": 8 }
```

Leia o produto antes do ajuste e envie a quantidade disponível observada como
`expectedAvailableQuantity`. O banco só grava a nova quantidade se a anterior
ainda for a esperada. Uma alteração concorrente retorna 409: consulte novamente
antes de decidir o novo valor. A operação aceita inteiros de zero a 2147483647.
Valores negativos, frações e strings são rejeitados. `reservedQuantity` e
`soldQuantity` não podem ser alterados por essa rota; são destinados ao futuro
fluxo de pedidos. O ajuste representa unidades **disponíveis**, não o total físico
que inclui unidades reservadas.

Produto inexistente retorna 404. Produto legado sem registro de estoque retorna
`inventory: null` na consulta e 409 no ajuste, em vez de criar um estoque com
valores presumidos. Falhas de banco são sanitizadas como 503. Conflitos de
serialização têm até três tentativas e depois retornam 409.

Exemplo em PowerShell, reutilizando `$authHeaders` obtido no login:

```powershell
Invoke-RestMethod -Uri 'http://localhost:3000/products/options' -Headers $authHeaders
Invoke-RestMethod -Uri 'http://localhost:3000/products?page=1&limit=20' -Headers $authHeaders

$stockBody = @{ expectedAvailableQuantity = 5; availableQuantity = 8 } | ConvertTo-Json
Invoke-RestMethod -Method Patch `
  -Uri 'http://localhost:3000/products/UUID-DO-PRODUTO/inventory' `
  -Headers $authHeaders -ContentType 'application/json' -Body $stockBody
```

Os testes HTTP em `src/modules/products/products.spec.ts` usam Prisma simulado e
JWT real para cobrir validação, acesso administrativo, preço decimal, criação
atômica, filtros, referências e conflitos de estoque.

## Carrinho de compras

As rotas `/cart` exigem JWT de um usuário autenticado, CUSTOMER ou ADMIN. Cada
usuário acessa somente seu próprio carrinho; a identificação vem do token e não
é recebida no corpo ou na URL. Não é necessário configurar Scrydex para operar
o carrinho sobre produtos já cadastrados. Não há novas variáveis nem migrations.

| Método e rota | Operação |
| --- | --- |
| `GET /cart` | Consulta o carrinho e recalcula os valores |
| `PUT /cart/items/:productId` | Adiciona ou define a quantidade de um produto |
| `DELETE /cart/items/:productId` | Remove o produto do próprio carrinho |
| `DELETE /cart` | Esvazia o próprio carrinho |

O PUT recebe somente `quantity`, um inteiro entre 1 e 999:

```json
{ "quantity": 3 }
```

Esse valor é a quantidade final desejada, não um incremento: repetir a mesma
requisição mantém três unidades. Cada carrinho aceita até 100 produtos distintos.
Para remover, use DELETE; quantidade zero é rejeitada. O `productId` é o UUID do
produto local, não o UUID da carta nem seu identificador externo.

Só é possível adicionar/atualizar produtos ativos, com categoria, condição e
idioma ativos, preço positivo e estoque disponível suficiente. Produto ausente
retorna 404; indisponibilidade, falta de estoque ou limite de itens retornam 409.
Parâmetros inválidos e campos extras (incluindo preço ou identificação de outro
usuário) retornam 400. Operações concorrentes têm até três tentativas de transação;
conflitos persistentes retornam 409. Falhas de banco são sanitizadas como 503.

Todas as operações bem-sucedidas retornam HTTP 200 com o carrinho atualizado:

```json
{
  "id": null,
  "updatedAt": null,
  "items": [],
  "summary": {
    "itemCount": 0,
    "totalQuantity": 0,
    "subtotal": "0.00",
    "allItemsAvailable": false
  }
}
```

Esse é também o resultado para uma conta sem carrinho, sem criar registros na
consulta. O carrinho é criado na primeira adição. Cada item contém `id`,
`productId`, `quantity`, `unitPrice`, `subtotal`, `available`, `unavailableReason`,
`availableQuantity`, `card`, `category`, `condition` e `language`. Preços e totais
são strings com duas casas decimais e calculados com Decimal.

A consulta usa preços atuais. Se o estoque diminuir ou o produto ficar inativo,
o item permanece visível com `available: false`. Os motivos possíveis são
`PRODUCT_INACTIVE`, `OPTION_INACTIVE`, `INVALID_PRICE`, `OUT_OF_STOCK` e
`INSUFFICIENT_STOCK`. O subtotal inclui todos os itens, inclusive indisponíveis,
e não inclui frete ou descontos. `allItemsAvailable` só é verdadeiro quando o
carrinho não está vazio e todos os itens estão disponíveis naquele momento.

**O carrinho não reserva nem debita estoque e não garante preço ou disponibilidade
para uma compra futura.** A etapa de pedidos deverá revalidar tudo e reservar
estoque na sua própria transação. Limpar o carrinho de um usuário não afeta os
demais, e remover um item ausente é uma operação idempotente.

Exemplo em PowerShell com `$authHeaders` obtido no login:

```powershell
Invoke-RestMethod -Uri 'http://localhost:3000/cart' -Headers $authHeaders

Invoke-RestMethod -Method Put `
  -Uri 'http://localhost:3000/cart/items/UUID-DO-PRODUTO' `
  -Headers $authHeaders -ContentType 'application/json' -Body '{ "quantity": 3 }'

Invoke-RestMethod -Method Delete `
  -Uri 'http://localhost:3000/cart/items/UUID-DO-PRODUTO' -Headers $authHeaders

Invoke-RestMethod -Method Delete -Uri 'http://localhost:3000/cart' -Headers $authHeaders
```

Os testes em `src/modules/cart/cart.spec.ts` cobrem autenticação, isolamento por
usuário, quantidades, disponibilidade, atualização de preços, totais decimais,
limites, remoção, repetição de PUT e tratamento de conflitos.

## Comandos de teste

```bash
# unit tests
$ npm run test

# e2e tests
$ npm run test:e2e

# test coverage
$ npm run test:cov
```

## Deployment

When you're ready to deploy your NestJS application to production, there are some key steps you can take to ensure it runs as efficiently as possible. Check out the [deployment documentation](https://docs.nestjs.com/deployment) for more information.

If you are looking for a cloud-based platform to deploy your NestJS application, check out [Mau](https://mau.nestjs.com), our official platform for deploying NestJS applications on AWS. Mau makes deployment straightforward and fast, requiring just a few simple steps:

```bash
$ npm install -g @nestjs/mau
$ mau deploy
```

With Mau, you can deploy your application in just a few clicks, allowing you to focus on building features rather than managing infrastructure.

## Observability

In production applications, observability is essential for understanding how your system behaves, detecting issues early, and maintaining reliable performance.

[NestJS Observe](https://observe.nestjs.com) automatically instruments your NestJS application, giving you deep visibility into your system with minimal setup:

- **Distributed tracing:** Follow requests across services and understand how they flow through your system.
- **Waterfall analysis:** Visualize request execution and identify slow operations, bottlenecks, and unexpected delays.
- **Performance analysis:** Analyze application performance in real time and quickly pinpoint areas that need optimization.
- **Metrics:** Track key application and infrastructure metrics to understand system health and performance trends.
- **Logging:** Centralize and correlate logs with traces and other telemetry to make debugging easier.
- **Error tracking:** Detect errors quickly and investigate their root causes with the surrounding context.
- **SLA monitoring:** Track service-level objectives and identify when your application is approaching or exceeding defined thresholds.
- **Alarms and alerts:** Set up alerts for critical errors, performance degradation, SLA violations, and other anomalies so your team can react quickly.

This project is already instrumented. Create a free account at [observe.nestjs.com](https://observe.nestjs.com), add an application, and paste the generated app key and secret into the `ObserveModule.forRoot()` call in `src/app.module.ts`.

The free plan needs no payment details and covers 300,000 events a month. You can also browse the [live demo](https://www.observe-demo.nestjs.com/dashboard) first - the whole dashboard over a busy service's data, with nothing to install.

## Resources

Check out a few resources that may come in handy when working with NestJS:

- Visit the [NestJS Documentation](https://docs.nestjs.com) to learn more about the framework.
- For questions and support, please visit our [Discord channel](https://discord.gg/G7Qnnhy).
- To dive deeper and get more hands-on experience, check out our official video [courses](https://courses.nestjs.com/).
- Deploy your application to AWS with the help of [NestJS Mau](https://mau.nestjs.com) in just a few clicks.
- Auto-instrument your application with [NestJS Observe](https://observe.nestjs.com). Distributed tracing, metrics, and logging made easy. Error tracking and performance monitoring for your NestJS applications.
- Visualize your application graph and interact with the NestJS application in real-time using [NestJS Devtools](https://devtools.nestjs.com).
- Need help with your project (part-time to full-time)? Check out our official [enterprise support](https://enterprise.nestjs.com).
- To stay in the loop and get updates, follow us on [X](https://x.com/nestframework) and [LinkedIn](https://linkedin.com/company/nestjs).
- Looking for a job, or have a job to offer? Check out our official [Jobs board](https://jobs.nestjs.com).

## Support

Nest is an MIT-licensed open source project. It can grow thanks to the sponsors and support by the amazing backers. If you'd like to join them, please [read more here](https://docs.nestjs.com/support).

## Stay in touch

- Author - [Kamil Myśliwiec](https://twitter.com/kammysliwiec)
- Website - [https://nestjs.com](https://nestjs.com/)
- Twitter - [@nestframework](https://twitter.com/nestframework)

## License

Nest is [MIT licensed](https://github.com/nestjs/nest/blob/master/LICENSE).
