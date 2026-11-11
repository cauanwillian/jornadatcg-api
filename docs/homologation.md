# Homologação da HIKARI IMPORTADOS

## Estado em 10/11/2026

Os dois serviços estão publicados no Render, com API paga de US$ 7/mês aprovada
pelo usuário e site estático. As URLs temporárias observadas no painel são:

- Site: https://hikari-web-homolog.onrender.com
- API: https://hikari-api-homolog.onrender.com

O frontend está configurado para acessar `api-homolog.hikariimportados.com`.
Portanto, a publicação dos arquivos em `onrender.com` ainda não libera o fluxo
integrado do site. Os dois subdomínios foram cadastrados no Render, mas ainda não
resolvem no DNS. O usuário informou que poderá adicionar os registros na Hostinger
somente em 11/11/2026. Não alterar o CORS ou os cookies para contornar essa etapa.

O Supabase isolado `hikari-homolog` foi criado na organização escolhida, com
cotação de US$ 0/mês. Foram aplicadas as 12 migrations existentes pelo Prisma
7.10, com API/workers de homologação suspensos. A API foi reativada na versão
`e1a0a97` após sincronizar a configuração TLS do Blueprint. A conexão local
validou certificado/hostname; uma CA incorreta foi rejeitada. As 26 tabelas públicas
estão com RLS e sem acesso dos papéis anon/authenticated, conforme o script
`deploy/supabase-backend-access.sql`. Acesso pelo backend proprietário continua
funcionando. Os avisos INFO de RLS sem políticas são intencionais: não há acesso
direto aos dados por esses papéis.

Os checks públicos da API retornaram 200 para `/health`, `/health/ready`,
`/catalog/products?limit=1`, `/catalog/featured` e `/catalog/filters`; `/auth/me`
sem token retornou 401. O site temporário retornou 200 com título HIKARI e
`X-Robots-Tag: noindex, nofollow`. O banco ainda tem zero usuários, produtos e
pedidos. Contas e dados de teste do ambiente local não foram copiados.

Faltam DNS/certificados dos subdomínios, cadastro de conta/administrador e dados de
teste, configuração/verificação do webhook sandbox e os testes integrados abaixo.

| Verificação                                 | Resultado local                                                     |
| ------------------------------------------- | ------------------------------------------------------------------- |
| API: geração do Prisma Client, build e lint | Passaram                                                            |
| API: testes automatizados                   | 1.187 testes em 43 arquivos passaram                                |
| Site: build e lint                          | Passaram                                                            |
| Site: testes automatizados                  | 1.717 testes em 52 arquivos passaram                                |
| Asaas e Melhor Envio                        | Configurados como sandbox                                           |
| Recuperação por e-mail via Brevo            | Recebimento, troca de senha e login confirmados pelo usuário        |
| Banco Supabase                              | 12 migrations aplicadas, nenhuma incompleta; banco atual preservado |

Os testes automatizados usam mocks para integrações externas. Eles não comprovam
pagamento, cotação, emissão de etiqueta ou envio de e-mail no servidor publicado.

## Preparar o ambiente de destino

1. Identificar o provedor, a conta e o plano já contratado. A API precisa de
   Node.js 24, conectividade PostgreSQL/SMTP e execução contínua para os workers.
2. Definir o banco de homologação antes de aplicar migrations. Não conectar os
   workers local e remoto ao mesmo banco de teste simultaneamente. Não executar
   reset, seed ou migrations no banco atual por suposição.
3. Configurar uma instância da API e o site em HTTPS seguindo
   [deployment.md](deployment.md). Preferir site e `/api` na mesma origem. Se houver
   proxy, remover `/api` e reescrever o Path do cookie `/auth` para `/api/auth`.
4. Configurar os segredos no provedor: banco de homologação, JWT próprio, chaves
   sandbox e token próprio para o webhook. Usar `NODE_ENV=production` também na
   homologação para ativar as verificações e o cookie Secure.
5. Ajustar `AUTH_ALLOWED_ORIGINS` e `PASSWORD_RESET_URL` para a origem publicada.
   Compilar o site com `VITE_API_BASE_URL=/api` se essa for a topologia escolhida.
6. Executar build, migrations no banco de destino e início conforme o guia.
   Confirmar `/health/ready` pela URL pública, além de verificar logs sanitizados.
7. Configurar o webhook sandbox do Asaas para a nova URL e conferir sua autenticação.
   Não reutilizar a URL temporária do túnel local para o servidor publicado.

Não colocar `.env`, senhas, links de recuperação, tokens Bearer ou dados pessoais
em commits, capturas de teste ou registros de homologação. Antes de expor o
ambiente, revisar o cadastro de teste e usar contas controladas pela equipe.

## Roteiro de teste após publicar

Todos os itens abaixo estão pendentes **no ambiente publicado**. Anotar o
resultado, data e identificadores não sensíveis dos registros criados, sem tokens.

| Fluxo               | Evidência esperada                                                                               |
| ------------------- | ------------------------------------------------------------------------------------------------ |
| Saúde e catálogo    | Site HTTPS, imagens e logo carregam; API e banco respondem; filtros e detalhes funcionam         |
| Autenticação        | Cadastro/login, recarga com sessão renovada e logout; rota privada bloqueada sem sessão          |
| Renovação de sessão | Cookie HttpOnly/Secure/Strict com Path correto; rotação funciona; logout impede reutilização     |
| Recuperação         | Link recebido aponta para homologação; nova senha funciona; link usado não pode ser reutilizado  |
| Carrinho e pedido   | Inclusão/alteração/remoção, total correto e reserva de estoque conferida                         |
| Pix de compra       | Cobrança sandbox, webhook autenticado e confirmação idempotente; estoque não baixa duas vezes    |
| Compras acumuladas  | Itens pagos disponíveis, seleção parcial e prevenção de alocação duplicada                       |
| Frete separado      | Cotação Melhor Envio, escolha de serviço e Pix sandbox de frete; pagamento não cria outra compra |
| Etiqueta            | Embalar, criar, comprar e gerar no sandbox; URL de impressão disponível, sem duplicar operações  |
| Postagem e entrega  | Sincronização e estados locais coerentes com o cenário suportado no sandbox                      |
| Painel e estoque    | Acesso exclusivo ADMIN, importação Pokémon, produto, entrada e histórico consistentes            |
| Erros e limites     | Mensagens sem segredos, timeout de provedor e rate limit funcionando na topologia publicada      |

Superfrete e Frenet ficam fora da aprovação se não houver credenciais e validação.
A emissão fiscal permanece adiada. Não tratar esses itens como integrações
validadas por terem adapters ou campos implementados.

Se houver falha, interromper a etapa afetada, registrar a causa sem dados sensíveis
e corrigir antes de repetir. Pagamentos e etiquetas de homologação devem permanecer
em sandbox; a aprovação deste ambiente não autoriza ativar cobranças reais.
