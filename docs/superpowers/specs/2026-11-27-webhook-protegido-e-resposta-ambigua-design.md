# Desenho: webhook protegido e resposta ambígua no WhatsApp

Data: 2026-11-27 · Situação: aprovado

## Por quê

1. **Webhook aberto (pela leitura do código).** `/webhook-whatsapp` só exige senha se
   `WEBHOOK_TOKEN` existir. O molde não define, o distribuidor não envia e o túnel
   publica o salão inteiro. Uma resposta forjada pode cancelar o horário de um cliente.
   Não foi testado em produção.
2. **Cancelamento errado.** Com dois ou mais horários pendentes, um "2" ou "3" não diz
   qual. Em salões diferentes, cada um cancela o seu.

**Objetivo:** só o distribuidor aciona os salões, e o sistema nunca cancela quando há
mais de um horário possível.

**Fora do escopo:** perguntar ao cliente qual horário cancelar; avisar o salão sobre a
tentativa; os outros pontos do relatório (MA-02 em diante); a resposta "1".

## Caminhos considerados

| Caminho | Troca | Decisão |
|---|---|---|
| A. Na dúvida, não cancela | nesse caso o cliente não cancela sozinho | **escolhido** |
| B. O mais próximo vence | simples, mas ainda pode cancelar o errado | descartado |
| C. Perguntar "A ou B" | cômodo, mas exige lembrar a conversa | pode vir depois |

## Parte 1: proteção do webhook

- Sem `WEBHOOK_TOKEN` no `.env`, ou com senha errada, o salão responde **403**
  (fecha por padrão). Ao subir sem senha, o log avisa.
- A senha vai no cabeçalho `X-Webhook-Token`. O `?token=` continua aceito, para o modo
  com número próprio.
- Cada salão tem a sua senha. O distribuidor já lê o `.env` de cada um e envia a certa.
  O distribuidor não precisa de senha própria: não publica porta (`dispatcher/docker-compose.yml`).
- Cliente novo nasce com senha: `painel/lib/criar.js` e `scripts/novo-cliente.sh`.
  O molde ganha a linha `WEBHOOK_TOKEN=`.
- Clientes atuais: script `painel/gerar-tokens-webhook.js` (com `--simular`), no padrão
  do `gerar-segredos-agenda.js`. Nunca troca uma senha existente.
- `painel/.dockerignore` passa a excluir `**/.env.*`, **antes** de reconstruir o painel.

## Parte 2: resposta ambígua

**Pendente** = `confirmado` e ainda não terminou (inclui o horário em andamento).

No distribuidor, só para mensagem recebida com texto "2" ou "3":

1. Pergunta a cada salão em modo central quais pendentes o remetente tem
   (`POST /webhook-whatsapp/pendentes`, com senha). O salão resolve o `@lid`.
2. **Total 0 ou 1:** repassa a resposta como hoje.
3. **Total 2 ou mais:** não repassa. Pede a **um** dos salões com horário que envie a
   lista (`POST /webhook-whatsapp/ambiguo`, com senha).

Qualquer outro texto ("1", mensagem do dono) segue como hoje.

**Segunda trava, dentro do salão:** se o próprio banco tiver 2 ou mais pendentes, "2" e
"3" não cancelam, e o salão envia a lista dele. Cobre o modo com número próprio.

Mensagem (sem prefixo de um salão específico):

> Você tem mais de um horário marcado, então não cancelei nenhum:
> • Salão X — 28/11 às 15:00 (Corte)
>   Falar com o salão: https://wa.me/55...
> • Salão Y — 02/12 às 10:00 (Manicure)
>   Falar com o salão: https://wa.me/55...
> Para cancelar ou reagendar, fale com o salão.

O contato é o `negocio.whatsapp_contato` (ou `telefone`); sem número, vai só o nome.

## Decisões minhas (confira)

- **Salão que não responde à consulta** (parado, lento, versão antiga): o distribuidor
  decide com os que responderam e registra no log. Bloquear tudo faria um salão parado
  travar o cancelamento de todos. Risco: se o cliente também tiver horário no salão que
  falhou, o do outro pode ser cancelado.
- **Dois horários no mesmo dia e salão** (ex.: corte e manicure) também passam a exigir
  contato. É consequência da opção A.
- O horário em andamento conta. Quem está em atendimento e tem outro marcado recebe a
  lista, sem cancelamento.

## Publicação

A ordem evita perder respostas:

1. `git pull`; reconstruir o **painel** (já com o `.dockerignore` corrigido).
2. Rodar o script de senhas com `--simular` e depois de verdade. Conferir que **todos**
   os clientes ficaram com senha: quem ficar sem, passa a recusar todas as respostas.
3. Reconstruir a imagem do motor.
4. Recriar o **distribuidor primeiro**. Com salões antigos, ele repassa como hoje.
5. Recriar os salões com `up -d --force-recreate`, um por vez, Bya por último.
6. Conferir no WAHA que o webhook aponta para o distribuidor, e não direto a um salão.
7. Testar com o próprio número e conferir que uma chamada sem senha recebe 403.

O inverso (salões antes do distribuidor) faria os salões recusarem as respostas.

## Testes

Escritos antes do código: 403 sem senha, com senha errada e sem senha configurada; as
duas rotas novas; a segunda trava; o distribuidor com salões falsos (0, 1, 2 no mesmo
salão, 1 em cada de dois, um salão fora do ar); cliente novo com senha; script que não
troca senha existente.

## A cargo de quem implementar

Nomes internos, formato do JSON e organização das funções.
