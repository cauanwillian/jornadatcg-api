# Ativação da recuperação de senha por e-mail

O fluxo de recuperação já está integrado ao site e à API. Para entregar mensagens,
configure um serviço SMTP com TLS e um remetente permitido pelo provedor.
As configurações ficam somente no `.env` do backend. Não coloque senhas ou chaves
no frontend, em capturas de tela, no chat ou no Git.

## Configuração

Copie os valores fornecidos pelo seu serviço para:

```dotenv
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASSWORD=
SMTP_FROM=
PASSWORD_RESET_URL=http://localhost:5173/
```

- Use 587 com STARTTLS ou 465 com TLS direto, conforme o serviço.
- `SMTP_HOST` é somente o host, sem `smtp://`, porta ou caminho.
- `SMTP_FROM` é um único endereço autorizado, sem nome entre aspas.
- `SMTP_PASSWORD` é a credencial SMTP fornecida pelo serviço, que pode ser
  diferente da senha de acesso ao painel.
- `PASSWORD_RESET_URL` é a URL do frontend que o cliente abrirá, sem query ou
  fragmento. Use a porta e o host reais do site local (por exemplo,
  `http://127.0.0.1:5173/`); em produção, use HTTPS.
- Siga a validação de remetente e de domínio exigida pelo provedor. Ter uma conexão
  SMTP válida não significa que qualquer endereço de remetente será aceito.

## Conferência local

Na pasta do backend:

```powershell
npm run build
npm run email:check -- --config-only
npm run email:check
```

O primeiro comando de conferência valida o formato da configuração sem abrir
conexão. O segundo verifica conexão, TLS e autenticação, com prazo total de 15
segundos. Nenhum deles envia e-mail, consulta o banco ou cria tokens de recuperação.
Falhas retornam código de saída 1 e uma mensagem sem valores de configuração.
Após editar o `.env`, reinicie a API em desenvolvimento para carregar os valores.

A verificação SMTP não confirma autorização do remetente, entrega na caixa de
entrada, regras de domínio, disponibilidade do link ou atualização da senha.
O encerramento do transporte após timeout é solicitado ao Nodemailer; uma conexão
que já começou pode levar mais tempo para ser encerrada pelo sistema.

## Teste pelo site

1. Com a migration de recuperação aplicada e a API e o site rodando, abra o login.
2. Clique em **Esqueci minha senha** e informe uma conta de teste sua já cadastrada.
3. Confira a caixa de entrada e a pasta de spam. Abra o link recebido no mesmo
   ambiente configurado em `PASSWORD_RESET_URL`.
4. Defina a nova senha e confirme que consegue entrar com ela.
5. Confirme que o mesmo link não permite outra alteração e que sessões anteriores
   foram invalidadas. O link expira em 15 minutos.

O site mostra a mesma confirmação para contas existentes e inexistentes. Portanto,
essa confirmação sozinha não comprova entrega. Aguarde ao menos um minuto antes
de repetir a solicitação para a mesma conta. Se o envio falhar, os logs da API
mostram uma mensagem genérica, sem destinatário, senha ou link.

Não compartilhe o link recebido: ele permite alterar a senha enquanto estiver
válido. Tokens e senhas não devem ser usados em comandos ou impressos no terminal.

## Diagnóstico

| Resultado | O que conferir |
| --- | --- |
| Configuração inválida | As seis variáveis acima e o formato da URL do frontend. |
| Falha na verificação SMTP | Host, porta, credencial SMTP, TLS, DNS, firewall e acesso à rede. |
| Verificação passou, mensagem não chegou | Remetente autorizado, domínio, limites e registros de entrega no painel do serviço; caixa de spam. |
| Link não abre | API e site ativos, URL do frontend e acesso do dispositivo que abriu o e-mail. |
| Link inválido ou expirado | Solicite outro link; ele pode ter expirado, sido usado ou invalidado por outra troca de senha. |

O módulo fiscal fica adiado. Esta etapa não depende de conta fiscal ou da API de
cartas, nem altera estoque ou pedidos.
