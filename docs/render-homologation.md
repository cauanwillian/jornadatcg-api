# Proposta de homologação no Render

O usuário aprovou em 10/11/2026 a API paga de US$ 7/mês no Render, sujeita a
consumo adicional e impostos. A publicação ainda não foi aplicada. O arquivo
[`deploy/render-homologation.yaml`](../deploy/render-homologation.yaml) cria uma
API paga e um site estático. Conferir que o painel apresenta o plano aprovado;
mudanças de preço ou recursos exigem revisão. O domínio continua na Hostinger.

## Recursos e endereços propostos

- API: uma instância Node.js 24, plano `0.5c-512mb`, região Virginia.
- Site: arquivos estáticos do repositório web, sem serviço Node adicional.
- Banco: projeto Supabase `hikari-homolog`, criado em 10/11/2026 com cotação de
  US$ 0/mês na organização escolhida. Conexão privada e migrations pendentes.
- Site: `https://homolog.hikariimportados.com`.
- API: `https://api-homolog.hikariimportados.com`.

Os endereços acima são planejados: ainda não têm DNS/serviços configurados.
Ambos usam HTTPS e o mesmo domínio principal para permitir o cookie Strict entre
site e API. Nesta topologia, o cookie continua em `/auth` e não há proxy `/api`.
Usar somente as URLs configuradas, evitando testar a sessão entre subdomínios
temporários `onrender.com`, que podem ser tratados como sites distintos.

O plano proposto tem 512 MB. Validar memória durante os testes de homologação;
essa escolha inicial não representa dimensionamento aprovado para produção.
Auto-deploy está desabilitado até concluir a validação do ambiente.

## Antes de aplicar o Blueprint

1. Confirmar o plano e seus custos. O site estático está sujeito às franquias de
   tráfego/build; a API paga e eventuais excedentes são cobrados pelo Render.
2. Criar/conectar a conta Render e autorizar acesso aos dois repositórios GitHub.
3. Preparar o banco isolado e uma conexão privada `DATABASE_URL` de homologação.
   Revisar o custo do Supabase antes de criar projetos/branches pagos.
4. Aplicar as migrations nesse banco usando a versão local do Prisma 7.10 e um
   ambiente dedicado. A conexão nunca deve ser impressa ou incluída no histórico.
   O Blueprint deliberadamente não roda migrations durante build/redeploy:
   migrations que exigem workers parados devem seguir o procedimento do guia.
5. Preparar uma conta ADMIN de teste nesse banco pelo comando local existente,
   sem copiar automaticamente contas, senhas ou dados pessoais do banco atual.
6. Revisar/enviar os arquivos dos dois repositórios necessários à publicação.
   O Blueprint obtém código do GitHub, não das alterações locais não enviadas.

## Publicar e configurar

No painel Render, criar um Blueprint a partir do repositório da API e escolher o
caminho `deploy/render-homologation.yaml`. Revisar os serviços e a cobrança antes
de aplicar. Preencher os campos `sync: false` no painel, nunca no YAML. Os campos
JWT/webhook usam valores novos gerados pelo Render, sem valores padrão no Git.

Usar as chaves **sandbox** de Asaas/Melhor Envio. Manter Superfrete e Frenet sem
credenciais enquanto não estiverem em teste. Dados do remetente e credenciais SMTP
devem ser preenchidos de forma privada. O complemento do endereço pode ficar vazio.

Após criar os serviços, copiar os destinos DNS exibidos pelo Render para os dois
subdomínios na Hostinger, preservando registros de e-mail e do domínio principal.
Não inventar IPs ou destinos CNAME. Aguardar os certificados HTTPS dos dois hosts.

Configurar o webhook sandbox do Asaas para
`https://api-homolog.hikariimportados.com/webhooks/asaas` e o token gerado para
esta API. Não apontar o webhook local para o banco isolado por suposição: os
pagamentos testados devem ter sido criados pelo mesmo ambiente.

Conferir logs, `/health/ready`, configuração SMTP e executar o
[roteiro de homologação](homologation.md) pelas URLs públicas. Para os fluxos que
precisam de login, o usuário entra pelo navegador sem compartilhar a senha.

## Referências

- [Blueprint YAML e planos de compute](https://render.com/docs/blueprint-spec)
- [Sites estáticos](https://render.com/docs/static-sites)
- [Limitações do plano gratuito](https://render.com/docs/free)
- [Plano inicial e preços publicados pelo Render](https://render.com/articles/set-up-self-hosted-github-actions-runners-on-render)
