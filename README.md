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

### Produto fictício para testes locais

Para testar sem depender do Scrydex, execute:

```powershell
npm run seed:test-product
```

O comando cria no banco de `DATABASE_URL` uma coleção, uma carta identificada
como `[TESTE] Pikachu fictício`, categoria, condição e idioma próprios de teste,
além de um produto ativo de R$ 10,00 com cinco unidades disponíveis. Não exige
chaves do Scrydex ou Asaas. Só executa fora de `NODE_ENV=production` e com
`ASAAS_ENVIRONMENT=sandbox` (ou não definido).

O ID do produto é `c70182cc-f671-480c-87f2-b4914659de22`. Executar novamente
reutiliza o cadastro e exibe o estado atual: não duplica o produto nem repõe
estoque consumido, zera reservas ou altera preços. O comando não cria usuários,
carrinhos, pedidos ou cobranças. Nenhuma migration adicional é necessária.

Com `$authHeaders` do login, adicione uma unidade:

```powershell
Invoke-RestMethod -Method Put `
  -Uri 'http://localhost:3000/cart/items/c70182cc-f671-480c-87f2-b4914659de22' `
  -Headers $authHeaders -ContentType 'application/json' -Body '{"quantity":1}'
```

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
para uma compra futura.** A etapa de pedidos revalida tudo e reserva
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

## Pedidos e compras acumuladas

O cliente pode fazer compras separadas para pedir um envio conjunto no futuro.
Esta etapa cria pedidos **pendentes de pagamento**, sem exigir endereço ou cobrar
frete. `shippingAmount` é `0.00` porque o envio será contratado separadamente;
isso não significa frete grátis. Pagamentos Pix usam o Asaas; a solicitação de
envio será implementada na próxima etapa. Somente compras com pagamento confirmado
poderão ser liberadas para envio.

Todos os endpoints abaixo exigem `Authorization: Bearer <accessToken>` e acessam
apenas os pedidos do usuário autenticado, inclusive quando ele é administrador.

| Método | Rota | Função |
| --- | --- | --- |
| POST | `/orders` | Criar pedido a partir do carrinho |
| GET | `/orders?page=1&pageSize=20&status=PENDING_PAYMENT` | Listar os próprios pedidos |
| GET | `/orders/:id` | Consultar um pedido com os itens da compra |
| POST | `/orders/:id/cancel` | Cancelar pedido pendente e liberar a reserva |

### Criar pedido

Envie o header `Idempotency-Key` com um UUID v4 novo para cada checkout e o corpo:

```json
{ "expectedSubtotal": "25.90" }
```

Use o subtotal retornado por `GET /cart`. O valor deve ser uma string positiva
com duas casas decimais, até `9999999999.99`. Outros campos no corpo são rejeitados;
o servidor calcula os preços e obtém o usuário pelo token. Se o subtotal mudou,
a resposta será 409 e será necessário consultar e confirmar o carrinho novamente.

Na mesma transação serializável, o servidor revalida o carrinho, reserva as
unidades (`availableQuantity` diminui, `reservedQuantity` aumenta), grava o pedido
e esvazia o carrinho. `soldQuantity` permanece inalterado. Falhas revertem todas
essas operações. O pedido guarda os preços e nomes das cartas, coleções, categorias,
condições e idiomas no momento da compra, sem depender de alterações posteriores
no catálogo.

O endpoint retorna 200 tanto na criação como na repetição da mesma operação. Em
caso de timeout ou perda de conexão, **repita a mesma chave e o mesmo corpo** para
recuperar o pedido sem reservar novamente, mesmo após reiniciar o backend. A chave
é exclusiva por usuário. Reutilizá-la com outro subtotal retorna 409; reutilizá-la
após cancelar retorna o pedido cancelado. Uma nova compra exige uma nova chave.
Depois de um checkout concluído, repetir sua chave não consome um carrinho novo.

### Consulta e cancelamento

A listagem retorna `{ items, page, pageSize, total }`. `page` vai de 1 a 1000000,
`pageSize` de 1 a 100 (padrão 20), e `status` aceita os valores de `OrderStatus`.
Valores monetários são strings com duas casas decimais e datas usam ISO 8601.
Pedidos inexistentes ou pertencentes a outro usuário retornam 404.

O cancelamento retorna 200 e só aceita pedidos `PENDING_PAYMENT` sem pagamento
pendente, pago ou reembolsado. A liberação de estoque e a mudança para `CANCELLED`
são atômicas. Repetir o cancelamento retorna o mesmo pedido sem liberar estoque
novamente. Os itens não voltam automaticamente ao carrinho. Pedidos em outros
estados, pagamentos em processamento e reservas inconsistentes retornam 409.

Pedidos novos têm `expiresAt`, com prazo padrão de 30 minutos. Um worker verifica
pedidos vencidos a cada minuto. Pedidos sem cobrança ativa são cancelados e suas
reservas são liberadas. Havendo cobrança Pix, a liberação depende da confirmação
de cancelamento no Asaas. Pedidos antigos sem `expiresAt` não são cancelados
automaticamente; ao iniciar o primeiro Pix, recebem um prazo. Ainda não existe
endpoint para iniciar o envio.

Entradas inválidas retornam 400, ausência de autenticação 401, conflitos 409 e
indisponibilidade do banco 503, sem expor informações internas.

### Testar em PowerShell

Com `$authHeaders` obtido no login e produtos adicionados ao carrinho:

```powershell
$cart = Invoke-RestMethod -Uri 'http://localhost:3000/cart' -Headers $authHeaders
$checkoutKey = [guid]::NewGuid().ToString()
$checkoutHeaders = @{
  Authorization = $authHeaders.Authorization
  'Idempotency-Key' = $checkoutKey
}
$checkoutBody = @{ expectedSubtotal = $cart.summary.subtotal } | ConvertTo-Json

$order = Invoke-RestMethod -Method Post -Uri 'http://localhost:3000/orders' `
  -Headers $checkoutHeaders -ContentType 'application/json' -Body $checkoutBody

Invoke-RestMethod -Uri 'http://localhost:3000/orders?page=1&pageSize=20' -Headers $authHeaders
Invoke-RestMethod -Uri "http://localhost:3000/orders/$($order.id)" -Headers $authHeaders

Invoke-RestMethod -Method Post `
  -Uri "http://localhost:3000/orders/$($order.id)/cancel" -Headers $authHeaders
```

O prazo pode ser ajustado com `ORDER_RESERVATION_MINUTES` (1 a 1440). A alteração
vale para novos prazos, sem modificar os já gravados. Para preparar outro ambiente:

```powershell
npx prisma migrate deploy --config prisma7.config.ts
npx prisma generate --config prisma7.config.ts
npm run build
```

A migration adiciona apenas `orders.checkoutKey` (nullable para compatibilidade
com registros antigos) e um índice único de `userId + checkoutKey`.

## Pagamentos Pix com Asaas

### Configuração

Adicione ao `.env`, sem versionar os valores reais:

```dotenv
ASAAS_ENVIRONMENT=sandbox
ASAAS_API_KEY="sua-chave-do-sandbox"
ASAAS_WEBHOOK_TOKEN="token-aleatorio-proprio-do-webhook"
ORDER_RESERVATION_MINUTES=30
```

Use aspas na chave para preservar seu conteúdo. O ambiente padrão é `sandbox`;
`production` precisa ser informado explicitamente e usa outra credencial.
Os pagamentos são identificados por ambiente (`asaas:sandbox` ou `asaas:production`).
Não troque o ambiente de uma instalação com cobranças pendentes; use instalações
e bancos separados para testes e produção. Sem chave, os endpoints Pix retornam
503 e a reconciliação externa permanece inativa. Carrinho e pedidos continuam
disponíveis.

O token do webhook deve ter de 32 a 255 caracteres, sem espaços, e ser diferente
da API key. Gere um segredo aleatório localmente e configure o mesmo valor no
Asaas e no `.env`. A configuração do webhook no painel Asaas deve apontar para:

```text
https://SEU-DOMINIO-PUBLICO/webhooks/asaas
```

O Asaas não consegue acessar `localhost`; para testar a entrega do webhook é
necessário um endereço HTTPS público que encaminhe para o backend. Cadastre os
eventos `PAYMENT_CREATED`, `PAYMENT_UPDATED`, `PAYMENT_CONFIRMED`,
`PAYMENT_RECEIVED`, `PAYMENT_OVERDUE`, `PAYMENT_DELETED` e `PAYMENT_REFUNDED`.
O header de autenticação esperado é `asaas-access-token`.

Referências oficiais: [ambiente de testes](https://docs.asaas.com/docs/visao-geral),
[configurar webhook](https://docs.asaas.com/docs/criar-novo-webhook-pela-aplicacao-web)
e [cobrança Pix](https://docs.asaas.com/docs/cobrancas-via-pix).

### Endpoints e teste local

| Método | Rota | Função |
| --- | --- | --- |
| POST | `/orders/:orderId/payments/pix` | Criar ou recuperar o Pix do pedido |
| GET | `/orders/:orderId/payments/pix` | Reconciliar e consultar o Pix |
| GET | `/orders/:orderId/payments` | Consultar o histórico local de pagamentos |
| POST | `/webhooks/asaas` | Receber atualizações autenticadas do Asaas |

As três primeiras rotas exigem JWT e pertencimento do pedido. O cliente não pode
informar preço, status de pagamento ou ID de outro pagador. O POST aceita somente
`{ "cpf": "CPF_VALIDO_COM_11_DIGITOS" }`, valida os dígitos verificadores e registra
o CPF no usuário se ainda não existir. Um CPF já registrado não pode ser substituído
por esta rota. O pagador é localizado no Asaas por referência do usuário; novos
cadastros têm notificações automáticas desabilitadas.

Com `$authHeaders` do login e `$order` criado pelo checkout:

```powershell
$pixBody = @{ cpf = 'SEU_CPF_COM_11_DIGITOS' } | ConvertTo-Json
$pix = Invoke-RestMethod -Method Post `
  -Uri "http://localhost:3000/orders/$($order.id)/payments/pix" `
  -Headers $authHeaders -ContentType 'application/json' -Body $pixBody

$pix.pix.payload # Pix copia e cola
# $pix.pix.encodedImage contém a imagem PNG em Base64 para o futuro painel.

Invoke-RestMethod -Uri "http://localhost:3000/orders/$($order.id)/payments/pix" -Headers $authHeaders
Invoke-RestMethod -Uri "http://localhost:3000/orders/$($order.id)/payments" -Headers $authHeaders
Invoke-RestMethod -Uri "http://localhost:3000/orders/$($order.id)" -Headers $authHeaders
```

A resposta Pix contém `{ payment, pix, reservationExpiresAt }`. O objeto `pix`
inclui `encodedImage`, `payload` e `expirationDate` do provedor, e será `null`
quando o pagamento não estiver pendente ou o prazo local tiver acabado.
Valores monetários usam strings com duas casas decimais. O vencimento remoto do
QR Code pode ser diferente do prazo local; o backend cancela a cobrança antes de
devolver o estoque. Veja as [regras de validade do QR Code](https://docs.asaas.com/reference/obter-qr-code-para-pagamentos-via-pix).

### Confirmação, repetição e expiração

- Uma cobrança por pedido e ambiente: repetir o POST retorna a mesma intenção.
  Um novo checkout deve ser feito somente depois de o anterior estar encerrado.
- Antes do POST externo, a tentativa é persistida. Em timeout, erro ambíguo ou
  reinício, a cobrança é procurada pela referência do pagamento local. O backend
  não repete automaticamente uma criação incerta. Se uma falha ocorrer entre a
  gravação da tentativa e seu envio, será necessária revisão no Asaas para liberar
  a intenção; a reserva permanece protegida. HTTP 400 definitivo permite corrigir
  a causa e repetir o mesmo pedido.
- O webhook valida seu token e consulta a cobrança usando a API key do servidor.
  Valor, pagador, referência, ambiente e método devem corresponder ao registro
  local. Os dados de status e valor enviados no corpo do webhook não são confiados.
- Apenas `RECEIVED` confirma o Pix. `CONFIRMED` pode representar análise cautelar
  e mantém a reserva. Ao confirmar, pagamento e pedido ficam `PAID` e as unidades
  passam de `reservedQuantity` para `soldQuantity` na mesma transação. A compra
  permanece acumulada, sem gerar envio ou cobrar frete.
- Notificações repetidas ou atrasadas não vendem nem liberam o estoque duas vezes.
  A idempotência se baseia nas transições persistidas do pagamento e do pedido.
- O worker de reconciliação roda a cada minuto em lotes de 20, como recuperação
  para falhas de webhook e cobranças vencidas. O webhook é o mecanismo principal.
  Ao vencer, cobranças `PENDING`/`OVERDUE` são consultadas e canceladas no Asaas;
  o estado é consultado novamente antes da liberação. `OVERDUE` sozinho não
  comprova cancelamento. Falhas de comunicação e estado incerto mantêm a reserva.
- Cada instância evita sobreposição de seus ciclos. Transações serializáveis e
  atualizações condicionais protegem as mudanças de estoque entre instâncias.

Esta etapa cobre Pix. Cartão, boleto e estornos automáticos não estão implementados.
Reembolsos, divergências e aprovação após encerramento exigem revisão financeira;
o backend não repõe automaticamente estoque de uma compra que pode ter sido enviada.
Nesses casos o webhook retorna 409 e os logs da reconciliação sinalizam o pagamento.
Monitore a fila de webhooks do Asaas: falhas repetidas podem pausá-la. O processamento
atual é síncrono e só responde 200 após consulta/aplicação; uma fila persistente de
eventos é uma evolução para maior volume.

Erros do provedor são sanitizados: 400 para recusa definitiva, 502 para resposta
inválida, 503 para indisponibilidade/configuração e 504 para timeout. Nenhuma chave,
CPF ou resposta bruta do provedor é incluída em mensagens de erro.

As migrations adicionam o prazo de reserva e seu índice, os identificadores do
pagador/tentativa externa e a unicidade por pedido/provedor. Execute `migrate deploy`
antes de iniciar a versão nova. Os testes automatizados simulam o Asaas; a validação
com a conta sandbox requer suas credenciais e a configuração do webhook.

## Endereços e compras disponíveis para envio

Todas as rotas abaixo exigem `Authorization: Bearer SEU_ACCESS_TOKEN` e acessam
somente dados da conta autenticada.

| Método | Rota | Uso |
| --- | --- | --- |
| POST | `/addresses` | Cadastrar endereço |
| GET | `/addresses` | Listar endereços |
| GET | `/addresses/:id` | Consultar endereço |
| PUT | `/addresses/:id` | Substituir endereço |
| DELETE | `/addresses/:id` | Excluir endereço |
| GET | `/shipments/available-items?page=1&pageSize=20` | Consultar compras acumuladas |

Exemplo no PowerShell, substituindo os dados pelo endereço do destinatário:

```powershell
$authHeaders = @{ Authorization = "Bearer SEU_ACCESS_TOKEN" }
$addressBody = @{
  label = "Casa"
  recipientName = "Nome do destinatário"
  zipCode = "78000-000"
  street = "Nome da rua"
  number = "123"
  complement = ""
  neighborhood = "Bairro"
  city = "Cuiabá"
  state = "MT"
  isDefault = $true
} | ConvertTo-Json

$address = Invoke-RestMethod -Method Post `
  -Uri "http://localhost:3000/addresses" `
  -Headers $authHeaders -ContentType "application/json" -Body $addressBody
$address | ConvertTo-Json

Invoke-RestMethod -Method Get `
  -Uri "http://localhost:3000/shipments/available-items?page=1&pageSize=20" `
  -Headers $authHeaders | ConvertTo-Json -Depth 6
```

O CEP aceita oito dígitos com ou sem hífen; a UF deve ser brasileira. `label` e
`complement` são opcionais e aceitam `null`. O PUT exige todos os campos obrigatórios
novamente. `isDefault` é opcional: o primeiro endereço é sempre principal; definir
outro como principal desmarca o anterior. Para desmarcar o principal, escolha outro
endereço como principal. Ao excluir o principal, o mais antigo restante assume essa
posição. Cada conta pode cadastrar até 20 endereços.

A consulta de compras retorna `items`, `page`, `pageSize`, `total` e `summary`.
Cada item identifica o pedido e seu item, preserva nome/preço da compra e informa
`purchasedQuantity`, `allocatedQuantity`, `availableQuantity`, `unitPrice` e
`availableSubtotal`. Valores monetários são strings com duas casas decimais.
O resumo contém `availableQuantity` e `availableValue` de todos os resultados,
independentemente da página. `pageSize` aceita de 1 a 100 (padrão 20).

Somente compras com pagamento confirmado, sem pagamento reembolsado, são elegíveis.
Quantidades vinculadas a envios não cancelados são descontadas, inclusive envios
parciais; envios cancelados liberam essas quantidades para a consulta. Itens totalmente
alocados não aparecem. Os dados históricos continuam disponíveis mesmo se o produto
for removido do catálogo. Nenhum resultado retorna lista vazia em `items`.

Esta consulta não reserva itens. A criação de uma solicitação de envio revalida e
aloca as quantidades em uma transação serializável. Estes endpoints não exigem novas
variáveis de ambiente nem migration adicional.

### Solicitar envio das compras acumuladas

| Método | Rota | Uso |
| --- | --- | --- |
| POST | `/shipments` | Solicitar envio de itens de uma ou mais compras |
| GET | `/shipments?page=1&pageSize=20` | Listar solicitações da conta |
| GET | `/shipments/:id` | Consultar solicitação |
| POST | `/shipments/:id/cancel` | Cancelar solicitação pendente sem cobrança ativa |

O POST exige `Idempotency-Key` UUID v4, `addressId` de um endereço próprio e `items`
com itens distintos (`orderItemId` e `quantity` inteira positiva), somando no máximo
70 cartas por solicitação. Não aceita
preço, frete ou status enviados pelo cliente. As quantidades podem ser parciais e vir
de pedidos diferentes. O endereço é copiado para o envio e não muda quando o cadastro
é atualizado ou excluído. A solicitação nasce `PENDING`, com
`shippingMethod: "TO_BE_DEFINED"` e `shippingCost: null` na resposta: frete ainda não
calculado. Isso não representa frete grátis. Cotação e pagamento do frete são
descritos abaixo; a emissão pelo Melhor Envio está documentada na seção administrativa.

Exemplo: consulte as compras e endereços, escolha os IDs retornados e execute:

```powershell
Invoke-RestMethod -Uri "http://localhost:3000/addresses" -Headers $authHeaders
Invoke-RestMethod -Uri "http://localhost:3000/shipments/available-items" `
  -Headers $authHeaders | ConvertTo-Json -Depth 6

$shipmentKey = [guid]::NewGuid().ToString()
$shipmentHeaders = @{
  Authorization = $authHeaders.Authorization
  "Idempotency-Key" = $shipmentKey
}
$shipmentBody = @{
  addressId = "ID_DO_ENDERECO"
  items = @(
    @{ orderItemId = "ORDER_ITEM_ID_RETORNADO_NA_CONSULTA"; quantity = 1 }
  )
} | ConvertTo-Json -Depth 6

$shipment = Invoke-RestMethod -Method Post `
  -Uri "http://localhost:3000/shipments" -Headers $shipmentHeaders `
  -ContentType "application/json" -Body $shipmentBody
$shipment | ConvertTo-Json -Depth 6

Invoke-RestMethod -Uri "http://localhost:3000/shipments/$($shipment.id)" `
  -Headers $authHeaders | ConvertTo-Json -Depth 6

# Opcional: cancelar antes de gerar a cobrança do frete
# Invoke-RestMethod -Method Post `
#   -Uri "http://localhost:3000/shipments/$($shipment.id)/cancel" -Headers $authHeaders
```

Em caso de timeout, repita o POST com o mesmo corpo e os mesmos `$shipmentHeaders`.
Não gere outra chave para repetir a mesma operação. A chave é usada como ID da
solicitação; tanto criação quanto repetição retornam HTTP 200. Reutilizá-la com
outro conteúdo retorna 409. Repetir uma solicitação cancelada devolve seu estado
cancelado; uma nova solicitação precisa de outra chave.

O cancelamento mantém o histórico e libera as quantidades para outra solicitação,
sem alterar estoque vendido nem o pagamento da compra. Só é permitido enquanto
`PENDING`, sem pagamento pendente, pago ou reembolsado e sem identificadores de
postagem. Uma cotação selecionada, sozinha, não bloqueia o cancelamento. Repetir o cancelamento
é seguro. Itens indisponíveis ou quantidade insuficiente retornam 409; endereço ou
solicitação de outra conta retorna 404; entrada inválida retorna 400.

### Cotação e pagamento separado do frete

O CEP de origem padrão é **78556-858**. A embalagem é definida pelo servidor:

| Quantidade total de cartas | Caixa | Altura × largura × comprimento | Peso total |
| --- | --- | --- | --- |
| 1 a 30 | Pequena | 3 × 12 × 17 cm | 150 g |
| 31 a 70 | Média | 5 × 10 × 15 cm | 150 g |

O peso inclui cartas, caixa e proteção, conforme informado pela loja. Acima de 70
cartas, o cliente deve dividir em solicitações separadas. Não há divisão automática
em volumes. Os valores são centralizados em `src/modules/shipments/shipping-package.ts`.
As APIs recebem peso em kg (0,15), dimensões em cm e valor declarado calculado pelos
preços históricos dos itens selecionados.

| Método | Rota | Uso |
| --- | --- | --- |
| POST | `/shipments/:id/quotes` | Cotar nos provedores configurados |
| POST | `/shipments/:id/quotes/:quoteId/select` | Escolher uma cotação salva |
| POST | `/shipments/:id/payments/pix` | Criar ou recuperar o Pix do frete, com `{ "cpf": "..." }` |
| GET | `/shipments/:id/payments/pix` | Consultar e reconciliar o Pix do frete |

As rotas exigem Bearer e verificam a propriedade do envio. A cotação retorna
`options`, `providers`, `package` e `expiresAt`. Cada opção tem `id`, `provider`,
`serviceCode`, `serviceName`, `carrier`, `amount`, `deliveryDays` e `expiresAt`.
O nome do provedor inclui o ambiente, por exemplo `superfrete:sandbox`.
Preços são strings decimais. O cliente envia apenas o ID da opção, nunca o valor
que será cobrado. GET `/shipments/:id` também informa a cotação selecionada e
`shippingPaidAt`.

Cada lote de cotações vale **15 minutos na aplicação**; não representa garantia
de preço para uma futura compra de etiqueta. Uma nova cotação invalida o lote e
a seleção anteriores. Depois que uma cobrança é criada, preço e escolha ficam
bloqueados. Cotação e pagamento são operações separadas da contratação da etiqueta.
A falha de um provedor não elimina opções dos outros. `providers` distingue
`OK`, `NOT_CONFIGURED`, `TIMEOUT`, `INVALID_RESPONSE` e `UNAVAILABLE`. Sem nenhum
provedor respondendo, a API retorna 503; com resposta válida sem cobertura, retorna
200 com `options: []`. Não existem preços fictícios de fallback.

Configure no `.env` (nunca envie os tokens ao Git):

```dotenv
SHIPPING_ORIGIN_ZIP_CODE=78556858
SHIPPING_CONTACT_EMAIL=seu-email-de-contato-tecnico
MELHOR_ENVIO_ENVIRONMENT=sandbox
MELHOR_ENVIO_TOKEN=
SUPERFRETE_ENVIRONMENT=sandbox
SUPERFRETE_TOKEN=
FRENET_TOKEN=
```

`SHIPPING_CONTACT_EMAIL` precisa ser um e-mail válido para o User-Agent técnico.
Um provedor sem token fica desabilitado. Melhor Envio e SuperFrete aceitam
`sandbox` ou `production` e usam tokens próprios de cada ambiente. A cotação Frenet
usa HTTPS no ambiente real. O Pix continua usando as variáveis `ASAAS_*` existentes;
cotações de sandbox não podem gerar uma cobrança Asaas de produção.

Documentação oficial usada para os adaptadores:

- [Melhor Envio: cálculo por produtos ou volumes](https://docs.melhorenvio.com.br/reference/calculo-de-fretes-por-produtos).
- [SuperFrete: cotação](https://superfrete.readme.io/reference/cotacao-de-frete) e [geração de token](https://superfrete.readme.io/reference/primeiros-passos).
- [Frenet: cotação](https://docs.frenet.com.br/reference/calculateshippingquote) e [acesso ao token](https://ajuda.frenet.com.br/knowledge-base/api-frenet/).

Depois de criar uma solicitação e configurar ao menos um provedor:

```powershell
$shipmentId = "ID_DA_SOLICITACAO_DE_ENVIO"
$quotes = Invoke-RestMethod -Method Post `
  -Uri "http://localhost:3000/shipments/$shipmentId/quotes" -Headers $authHeaders
$quotes | ConvertTo-Json -Depth 6

# Escolha um ID retornado em options; não use o ID do pedido de compra.
$quoteId = "ID_DA_COTACAO_ESCOLHIDA"
Invoke-RestMethod -Method Post `
  -Uri "http://localhost:3000/shipments/$shipmentId/quotes/$quoteId/select" `
  -Headers $authHeaders

$freightBody = @{ cpf = "SEU_CPF_VALIDO_COM_11_DIGITOS" } | ConvertTo-Json
$freightPix = Invoke-RestMethod -Method Post `
  -Uri "http://localhost:3000/shipments/$shipmentId/payments/pix" `
  -Headers $authHeaders -ContentType "application/json" -Body $freightBody
$freightPix | ConvertTo-Json -Depth 6

# Após confirmar no Asaas sandbox:
Invoke-RestMethod `
  -Uri "http://localhost:3000/shipments/$shipmentId/payments/pix" `
  -Headers $authHeaders | ConvertTo-Json -Depth 6
Invoke-RestMethod -Uri "http://localhost:3000/shipments/$shipmentId" `
  -Headers $authHeaders | ConvertTo-Json -Depth 6
```

A cobrança do frete tem `shipmentId` preenchido e `orderId: null`, com o mesmo
formato de QR Code dos pagamentos de compra. Repetir o POST no mesmo envio/ambiente
recupera a intenção existente. A API nunca repete uma criação externa incerta sem
reconciliação. O prazo do Pix acompanha a validade da cotação. O mesmo webhook
`POST /webhooks/asaas` e o worker periódico verificam ambas as modalidades.
Somente `RECEIVED` confirmado pelo Asaas marca o frete como pago e avança o envio
para `PREPARING`. Pagamentos de cartas e estoque vendido não são modificados.

Na expiração, uma cobrança externa precisa ser cancelada e consultada novamente
antes de encerrar a intenção local. Enquanto houver incerteza, o cancelamento do
envio continua bloqueado. Se a cobrança for encerrada sem pagamento, cancele a
solicitação e crie outra para cotar/pagar novamente; nesta versão há uma intenção
por envio/provedor. Reembolso e pagamento após encerramento exigem revisão financeira.

A migration `20261001000304_shipping_quotes_payments` cria as cotações e permite
que cada pagamento pertença **exatamente a um pedido ou a um envio**, por constraint
no PostgreSQL. Em outro ambiente execute:

```powershell
npx prisma migrate deploy --config prisma7.config.ts
npx prisma generate --config prisma7.config.ts
```

Os testes automatizados simulam as três APIs e o Asaas. A validação com cotações
reais depende da criação das contas e dos tokens. Compra, impressão e sincronização manual de etiquetas Melhor Envio estão disponíveis na seção administrativa.

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

## Preparação administrativa e etiquetas Melhor Envio

Todos os endpoints abaixo exigem Bearer de usuário ADMIN. A embalagem só pode ser
conferida após confirmação do pagamento das compras e do frete.

Preencha no `.env` os campos `SHIPPING_SENDER_*` do `.env.example` com nome,
documento, telefone, e-mail e endereço do remetente. O CEP continua sendo
`SHIPPING_ORIGIN_ZIP_CODE=78556858`. Reinicie o servidor após configurar.
Complemento é opcional. Em produção, esta integração exige inscrição estadual do
remetente e chave de nota fiscal (`invoiceKey`, 44 dígitos). No sandbox, a ausência
da chave é aceita exclusivamente para simulação.

| Método | Endpoint | Finalidade |
| --- | --- | --- |
| GET | `/admin/shipments?page=1&pageSize=20` | Fila de preparação e postagem |
| POST | `/admin/shipments/:id/pack` | Registrar conferência física da embalagem |
| POST | `/admin/shipments/:id/label` | Inserir etiqueta no carrinho do provedor |
| POST | `/admin/shipments/:id/label/checkout` | Comprar com saldo da carteira Melhor Envio |
| POST | `/admin/shipments/:id/label/generate` | Gerar etiqueta comprada |
| GET | `/admin/shipments/:id/label/print` | Obter link privado de impressão |
| POST | `/admin/shipments/:id/label/sync` | Consultar pagamento, geração, postagem e entrega |
| POST | `/admin/shipments/:id/label/recover/:remoteId` | Vincular criação cuja resposta foi perdida |

Exemplo PowerShell, após login de administrador e conferência física:

```powershell
$shipmentId = 'ID_DO_ENVIO'
$base = "http://localhost:3000/admin/shipments/$shipmentId"
Invoke-RestMethod -Method Post -Uri "$base/pack" -Headers $authHeaders

$body = @{
  recipientDocument = 'CPF_DO_DESTINATARIO_COM_11_DIGITOS'
  recipientPhone = 'TELEFONE_COM_DDD'
} | ConvertTo-Json
$label = Invoke-RestMethod -Method Post -Uri "$base/label" `
  -Headers $authHeaders -ContentType 'application/json' -Body $body
$label | ConvertTo-Json -Depth 6
```

Confira `cost` antes da compra. Execute separadamente:

```powershell
$checkout = @{ expectedCost = [string]$label.cost } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri "$base/label/checkout" `
  -Headers $authHeaders -ContentType 'application/json' -Body $checkout
Invoke-RestMethod -Method Post -Uri "$base/label/generate" -Headers $authHeaders
Invoke-RestMethod -Uri "$base/label/print" -Headers $authHeaders
Invoke-RestMethod -Method Post -Uri "$base/label/sync" -Headers $authHeaders
```

O Pix do cliente no Asaas não abastece automaticamente a carteira Melhor Envio.
A compra de etiqueta usa saldo dessa carteira, conforme a
[documentação de compra de fretes](https://docs.melhorenvio.com.br/reference/compra-de-fretes-1).
O link de impressão é privado e exige acesso à conta Melhor Envio.

São suportados nesta etapa os serviços Correios/Jadlog de códigos 1, 2, 3, 4 e 17.
Superfrete e Frenet continuam disponíveis para cotação, sem emissão de etiquetas.
A compra bloqueia custo superior ao frete pago e pagamentos sandbox em produção.

Tentativas são persistidas antes de chamadas externas. Se houver timeout ou falha
ambígua, não repita a compra às cegas: use `label/sync` e confira o painel do
provedor. Se a criação perdeu a resposta, obtenha o UUID da etiqueta no painel e
use `recover`; a API confere serviço, CEPs, documento e identificação do envio.
Não apague registros para contornar esses bloqueios.

A geração confirmada muda o envio para `READY_TO_SHIP`. A sincronização manual
atualiza `SHIPPED` e `DELIVERED` conforme o provedor; há também sincronização automática descrita abaixo. Cancelamento ou suspensão externa exige revisão administrativa e
não libera automaticamente itens nem estorna pagamentos.

## Sincronização automática de etiquetas

O worker de etiquetas consulta o Melhor Envio a cada 60 segundos enquanto a API
estiver em execução. Configure `SHIPPING_LABEL_SYNC_ENABLED=false` para desativar
ou `SHIPPING_LABEL_SYNC_INTERVAL_SECONDS` entre 30 e 3600 para ajustar o intervalo.
Os valores padrão dispensam alterações no `.env` existente.

Cada execução percorre até 20 etiquetas do ambiente configurado, em sequência,
com cursor para não deixar os últimos registros sem consulta. Envios entregues,
cancelados ou etiquetas que exigem revisão não são consultados automaticamente.
Falhas isoladas são registradas sem respostas externas ou dados pessoais e voltam
a ser consultadas em um ciclo posterior. O worker apenas consulta etiquetas já
vinculadas: não cria, compra nem solicita geração de etiquetas.

A sincronização manual continua disponível. Execuções não se sobrepõem na mesma
instância; em múltiplas réplicas, habilite o worker em apenas uma para evitar
consultas duplicadas ao provedor. Não há trava distribuída nesta etapa.

## Renovação de sessão

`POST /auth/login` mantém o JSON com `accessToken`, `expiresIn`, `tokenType` e
`user`, e adiciona o cookie `jornada_refresh`: HttpOnly, SameSite=Strict,
Path=/auth e Secure em produção (`NODE_ENV=production`, HTTPS obrigatório).
O token de acesso volta a durar 15 minutos; tokens antigos de 8 horas devem ser
substituídos por um novo login. O refresh token tem validade absoluta de 30 dias,
sem prolongamento a cada uso, e somente seu hash é armazenado no banco.

`POST /auth/refresh` usa o cookie, dispensa Bearer e devolve um novo access token,
substituindo o cookie. `POST /auth/logout` revoga a sessão do cookie e retorna 204.
Os dois endpoints exigem `X-Requested-With: JornadaTCG`. Logout não invalida
imediatamente JWTs de acesso já emitidos: eles expiram em até 15 minutos.
Reutilizar um refresh token consumido revoga toda a sessão correspondente.
O frontend deve serializar renovações (inclusive entre abas), não repetir
automaticamente um refresh cuja resposta se perdeu e pedir novo login em 401.

Configure `AUTH_ALLOWED_ORIGINS` com as origens exatas do frontend. Requisições
com Origin não autorizado são rejeitadas; CORS permite credenciais somente nas
origens configuradas. Frontend e API precisam estar no mesmo site para o cookie
SameSite=Strict (por exemplo app.exemplo.com e api.exemplo.com, ambos HTTPS).
No frontend use `credentials: 'include'` no login, refresh e logout, mantenha o
access token em memória e envie Bearer nas demais rotas. A renovação automática
na interface será implementada quando o frontend for criado.

PowerShell, preservando o cookie na mesma sessão:

```powershell
$credenciais = Get-Credential -Message 'E-mail e senha'
$loginBody = @{ email = $credenciais.UserName; password = $credenciais.GetNetworkCredential().Password } | ConvertTo-Json
$login = Invoke-RestMethod -Method Post -Uri 'http://localhost:3000/auth/login' -ContentType 'application/json' -Body $loginBody -SessionVariable sessao -ErrorAction Stop
$authHeaders = @{ Authorization = "Bearer $($login.accessToken)" }

# Renovar sem digitar a senha novamente
$login = Invoke-RestMethod -Method Post -Uri 'http://localhost:3000/auth/refresh' -WebSession $sessao -Headers @{ 'X-Requested-With' = 'JornadaTCG' } -ErrorAction Stop
$authHeaders = @{ Authorization = "Bearer $($login.accessToken)" }

# Encerrar esta sessão
Invoke-RestMethod -Method Post -Uri 'http://localhost:3000/auth/logout' -WebSession $sessao -Headers @{ 'X-Requested-With' = 'JornadaTCG' } -ErrorAction Stop
```

Migration: `20261003060000_refresh_sessions`, com RLS habilitada sem acesso público
à tabela de tokens. Tokens consumidos são mantidos até o fim da validade para
permitir detecção de reutilização; limpeza periódica de registros expirados pode
ser configurada posteriormente conforme a política de retenção.

## Catálogo público

Disponível sem login, usando apenas produtos já cadastrados no banco:

- `GET /catalog/products`: lista paginada.
- `GET /catalog/products/:id`: detalhes; produto oculto ou inexistente retorna 404.
- `GET /catalog/filters`: categorias, condições, idiomas e raridades com anúncios
  visíveis, e faixa global de preços (`null` quando vazia).

Parâmetros da listagem: `name` (busca parcial sem distinguir maiúsculas),
`categoryId`, `conditionId`, `languageId` (UUID), `rarity` (valor exato),
`minPrice`, `maxPrice` (decimal com ponto), `stock=available|unavailable`,
`sort=newest|oldest|price_asc|price_desc`, `page` (1 a 10000) e `limit` (1 a 100).
Padrões: página 1, 24 itens, mais recentes; inclui esgotados. Parâmetros inválidos,
repetidos ou desconhecidos retornam 400. Nenhum resultado retorna lista vazia.

A resposta contém `data` e `pagination` com `page`, `limit`, `total`, `totalPages`
e `hasMore`. Para carregar mais, incremente `page` mantendo os mesmos filtros.
Ao mudar filtros, volte à página 1. Empates usam o ID para ordenação estável;
como a paginação usa páginas, alterações no catálogo entre consultas podem
mudar a posição dos itens.

Produtos, categorias, condições e idiomas inativos ficam ocultos. A resposta
contém preço como string decimal, dados da carta e coleção, imagens, observação,
condição, idioma, categoria, `availableQuantity` e `inStock`. Estoque ausente é
tratado como zero. Estoque reservado, vendido e metadados externos não são
expostos. Disponibilidade é informativa e é revalidada no checkout existente.
`observation` e demais textos devem ser exibidos pelo frontend como texto,
sem renderização de HTML não confiável.

```powershell
Invoke-RestMethod 'http://localhost:3000/catalog/products?name=Pikachu&stock=available&sort=price_asc&page=1&limit=24' | ConvertTo-Json -Depth 8
Invoke-RestMethod 'http://localhost:3000/catalog/products?minPrice=5.00&maxPrice=50.00' | ConvertTo-Json -Depth 8
Invoke-RestMethod 'http://localhost:3000/catalog/filters' | ConvertTo-Json -Depth 6
```

Cadastro e edição continuam restritos ao administrador em `/products`.
Esta etapa não inclui banners, destaques nem estimativa de frete antes da compra.
Não exige migration ou novas variáveis de ambiente.

## Estimativa pública de frete

`GET /catalog/products/:id/shipping-estimate?zipCode=78000000&quantity=1`

Não exige login. `zipCode` aceita oito dígitos ou o formato `78000-000`;
`quantity` é opcional (padrão 1), inteiro de 1 a 70, limitado ao estoque disponível.
Produto oculto/inexistente retorna 404; quantidade sem estoque retorna 409;
parâmetros inválidos retornam 400. Há limite de 10 consultas por minuto por IP
(429 quando excedido). O limitador padrão é local à instância da API.

O backend consulta os provedores configurados usando o preço do banco, CEP de
origem existente e embalagem pequena até 30 cartas ou média de 31 a 70, ambas
com 150 g. Retorna `estimated`, `quotedAt`, `declaredValue`, `package`, `options`
e diagnóstico normalizado de cada provedor. Opções são ordenadas por preço e
prazo. Falhas parciais preservam as demais opções; indisponibilidade de todos
retorna 503; ausência de serviços em uma rota retorna opções vazias quando ao
menos um provedor respondeu normalmente.

Esta consulta não grava cotação, não reserva estoque, não cria pedido/envio nem
cobra o cliente. O valor não inclui outras compras acumuladas. Não use suas
opções para selecionar ou pagar frete: solicite uma nova cotação no fluxo de
envio existente. O frontend deve explicar que se trata de estimativa, inclusive
quando o provedor retornado indica sandbox.

```powershell
$produtoId = 'ID_DO_PRODUTO'
Invoke-RestMethod "http://localhost:3000/catalog/products/$produtoId/shipping-estimate?zipCode=78000000&quantity=1" | ConvertTo-Json -Depth 8
```

Reutiliza as variáveis de frete existentes. Não exige migration.

## Produtos em destaque

O administrador pode definir `featured` (booleano) e `featuredOrder` (inteiro
não negativo, menor primeiro) em `POST /products` ou `PATCH /products/:id`.
Esses campos também são retornados nas consultas administrativas. Produtos
existentes começam com `featured=false`, sem alteração de estoque ou preço.

`GET /catalog/featured` é público e retorna `{ data: [...] }`, com até 24 produtos
marcados, ativos, com referências ativas e estoque disponível maior que zero.
Empates de ordem usam o ID do produto. A resposta tem o mesmo formato público do
catálogo, sem estoque reservado/vendido. Lista vazia retorna 200.

O destaque fica salvo quando o produto esgota ou é desativado, mas fica oculto
até voltar a cumprir as regras. Para removê-lo definitivamente, envie
`featured=false`. Não há escolha automática de destaques.

```powershell
# Use o ID real do produto e o Bearer de administrador
$body = @{ featured = $true; featuredOrder = 1 } | ConvertTo-Json
Invoke-RestMethod -Method Patch -Uri "http://localhost:3000/products/$produtoId" -Headers $authHeaders -ContentType 'application/json' -Body $body -ErrorAction Stop

# Consulta pública
Invoke-RestMethod 'http://localhost:3000/catalog/featured' | ConvertTo-Json -Depth 8

# Remover destaque
$body = @{ featured = $false } | ConvertTo-Json
Invoke-RestMethod -Method Patch -Uri "http://localhost:3000/products/$produtoId" -Headers $authHeaders -ContentType 'application/json' -Body $body -ErrorAction Stop
```

Migration: `20261003080000_featured_products`. Nenhuma variável nova no `.env`.

## Banners da página inicial

Formato inicial: imagem estática de 1600 × 500 pixels, PNG/JPEG/WebP, até 5 MB.
A API decodifica e converte para WebP, removendo metadados. Imagens ficam em BYTEA
no PostgreSQL, adequadas ao pequeno volume inicial de banners; considerar object
storage/CDN ao crescer. Não há arquivos locais nem credenciais adicionais.

- `GET /banners`: até 20 banners ativos, ordenados por sortOrder e ID.
- `GET /banners/:id/image`: imagem WebP, somente banner ativo.
- `GET /admin/banners`: lista administrativa (até 100 registros).
- `POST /admin/banners`: multipart/form-data com image e title obrigatórios;
  link opcional (caminho interno como /catalogo), active (padrão false) e
  sortOrder (inteiro 0–999999, padrão 0).
- `PATCH /admin/banners/:id`: JSON para editar title, link, active e sortOrder.
- `POST /admin/banners/:id/image`: multipart com image para substituir a imagem.
- `GET /admin/banners/:id/image`: prévia autenticada, inclusive inativos.
- `DELETE /admin/banners/:id`: remove banner e imagem, retorna 204.

Todas as rotas administrativas exigem Bearer ADMIN. Os retornos JSON contêm
imageUrl relativo à origem da API e não incluem bytes da imagem. O frontend deve
usar title como texto alternativo e renderizar textos sem HTML. Erros de arquivo
inválido retornam 400, upload acima do limite retorna 413 e inexistente retorna
404. Link externo não é aceito nesta etapa.

Exemplo compatível com Windows PowerShell usando curl.exe (imagem já preparada):

```powershell
$imagem = 'C:\Users\cauan\Pictures\banner.png'
if (!(Test-Path -LiteralPath $imagem)) { throw 'Arquivo não encontrado.' }
curl.exe --fail-with-body -X POST 'http://localhost:3000/admin/banners' -H "Authorization: Bearer $($login.accessToken)" -F 'title=Bem-vindo à JornadaTCG' -F 'active=true' -F 'sortOrder=1' -F 'link=/catalogo' -F "image=@$imagem"
Invoke-RestMethod 'http://localhost:3000/banners' | ConvertTo-Json -Depth 6
```

Migration: `20261005090000_banners`, com RLS habilitada sem acesso direto público.
