# Webhook protegido e resposta ambígua — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** só quem tem a senha aciona o webhook de um salão, e "2"/"3" nunca cancelam quando há mais de um horário pendente.

**Architecture:** cada salão passa a exigir o seu `WEBHOOK_TOKEN`. Para "2"/"3", o distribuidor consulta os pendentes de todos os salões antes de repassar; com 2 ou mais, pede a um deles que envie a lista. Cada salão repete a trava com o próprio banco.

**Tech Stack:** Node 22, Express, better-sqlite3, `http` nativo no distribuidor, Jest + supertest.

**Spec:** `docs/superpowers/specs/2026-11-27-webhook-protegido-e-resposta-ambigua-design.md`

## Global Constraints

- Pendente = `status = 'confirmado' AND datetime(fim) > datetime('now')`, ordenado por `datetime(inicio)`.
- Sem `WEBHOOK_TOKEN` configurado, ou token errado: **403**. Vale para `/webhook-whatsapp` e as duas rotas novas.
- Cabeçalho `X-Webhook-Token`; `?token=` continua aceito.
- A resposta "1" e as mensagens do dono não mudam.
- `webhook-dispatcher.js` usa só módulos nativos do Node.
- Nunca trocar um token existente. Nunca imprimir token em log ou terminal.
- `.sh` com fim de linha LF.
- Branch nova a partir de `origin/main`, em worktree fora da pasta do projeto. Commits locais por tarefa; **push, PR e merge só com OK do Parllon**.
- Nada de `.reversa/` ou `_reversa_sdd/` nos commits.
- Testes no worktree: `NODE_PATH=<repo>/<app|painel>/node_modules node <repo>/<app|painel>/node_modules/jest/bin/jest.js --rootDir .`

## Review Focus

1. Remetente `@lid` que o WAHA não resolve: `/pendentes` responde 502, nunca "0 horários" (teste na tarefa 2).
2. Salão responde 200 com corpo que não é o JSON esperado: conta como sem resposta, sem derrubar o distribuidor (tarefa 3).
3. Corpo que não é JSON chega ao distribuidor: repassa como hoje, sem cair (tarefa 3).
4. Resposta com espaço ou quebra de linha (`" 3\n"`): vale como "3" e passa pela trava (tarefa 3).
5. Falha no salão escolhido para enviar a lista: tenta o próximo e **não** repassa a resposta (tarefa 3).

---

### Task 0: Área de trabalho

- [ ] Criar o worktree (`git worktree add --no-track -b fix/webhook-seguro <scratchpad>/wt-webhook origin/main`).
- [ ] Copiar o desenho e este plano para o worktree e fazer o commit (`docs: desenho e plano do webhook protegido`).
- [ ] Rodar a suíte de `app/`. Esperado: 3 falhas antigas em `mensagens.test.js`, o resto passa.
- [ ] Trazer a atualização local de `app/__tests__/mensagens.test.js` (feita em `instala-reversa`, sem commit). Rodar: 79 de 79. Commit `test: atualiza testes das mensagens ao formato atual`.

### Task 1: O salão exige a senha

**Files:**
- Modify: `app/server.js` (rota `/webhook-whatsapp`, boot)
- Modify: `app/__tests__/setup.js`, `agenda-ics.test.js`, `webhook-respostas.test.js`
- Create: `app/__tests__/webhook-auth.test.js`

**Interfaces:**
- Produces: middleware `exigirTokenWebhook(req, res, next)` em `server.js`; `setup.js` define `process.env.WEBHOOK_TOKEN = 'token-de-teste'`.

- [ ] **Step 1: Testes que falham**, em `webhook-auth.test.js` (mocks iguais aos de `webhook-respostas.test.js`):
  - `sem token → 403`, `token errado → 403`, `token de tamanho diferente → 403`
  - `cabeçalho X-Webhook-Token correto → 200`, `?token= correto → 200`
  - `WEBHOOK_TOKEN não configurado → 403 mesmo com cabeçalho vazio` (carregar o app com `jest.isolateModules` e a variável apagada)
  - em todo 403, `getCalendarClient` e `enviarWhatsapp` não são chamados
- [ ] **Step 2:** rodar; devem falhar os casos "sem token configurado" (hoje responde 200) e "cabeçalho correto" (hoje 403).
- [ ] **Step 3:** implementar. Comparar com `crypto.timingSafeEqual`, conferindo o tamanho antes. No boot, `console.warn` se o token estiver vazio e `WHATSAPP_MODE` não for `desativado`.
- [ ] **Step 4:** fazer os testes antigos enviarem o cabeçalho. Rodar a suíte inteira: tudo passa.
- [ ] **Step 5:** commit `Segurança: webhook do WhatsApp exige token`.

### Task 2: Pendentes, lista ambígua e trava no salão

**Files:**
- Create: `app/pendentes.js`, `app/__tests__/pendentes.test.js`
- Modify: `app/server.js`, `app/__tests__/webhook-respostas.test.js`

**Interfaces:**
- Consumes: `exigirTokenWebhook` (tarefa 1).
- Produces:
  - `listarPendentes(db, telefone) → linha[]` de `agendamentos`
  - `montarAvisoAmbiguo(itens: {salao, contato, inicio, servico}[], tz) → string`
  - em `server.js`: `resolverTelefone(from) → Promise<string|null>` (extraída do webhook; `@c.us` e `@lid`, demais `null`)
  - `POST /webhook-whatsapp/pendentes` `{from}` → 200 `{salao: string, contato: string, horarios: {inicio, servico}[]}`; telefone não resolvido → 502
  - `POST /webhook-whatsapp/ambiguo` `{from, itens}` → 200 `{ok: true}`; `itens` vazio ou ausente → 400; telefone não resolvido → 502
  - `salao` = `NEGOCIO.nome`; `contato` = `https://wa.me/<WA_CONTATO>` ou `''`

- [ ] **Step 1: Testes que falham.**
  - `montarAvisoAmbiguo`: texto exato do desenho para dois itens, data/hora em São Paulo no formato `28/11 às 15:00`; item sem contato não gera a linha "Falar com o salão".
  - `/pendentes`: devolve só os pendentes, em ordem; sem senha → 403; `@lid` com `fetch` rejeitando → 502 (Review Focus 1).
  - `/ambiguo`: chama `enviarWhatsapp(telefone, texto, { semPrefixo: true })` sem `await`; sem senha → 403; `itens: []` → 400.
  - Trava: com 2 pendentes, "2" e "3" não chamam `events.delete` nem `notificar`, os dois seguem `confirmado` e a lista com os dois é enviada. "1" continua respondendo `confirmado`.
  - Em `webhook-respostas.test.js`, os testes "dois horários futuros, vale o mais próximo" e "em andamento … cliente atrasado" passam a esperar a trava. Acrescentar: um único horário em andamento ainda é cancelado.
- [ ] **Step 2:** rodar e ver falhar (rotas dão 404, trava cancela).
- [ ] **Step 3:** implementar. O webhook usa `listarPendentes` e `resolverTelefone`; a trava vem depois do ramo "nenhum pendente".
- [ ] **Step 4:** suíte inteira passa.
- [ ] **Step 5:** commit `Resposta 2/3 não cancela quando há mais de um horário`.

### Task 3: Distribuidor consulta antes de repassar

**Files:**
- Modify: `app/webhook-dispatcher.js`
- Create: `app/__tests__/dispatcher.test.js`

**Interfaces:**
- Consumes: as rotas e os formatos da tarefa 2.
- Produces (exportados; `server.listen` só com `require.main === module`):
  - `Alvo = {slug, host, porta, token}`; `alvosCentral(dir = CLIENTES_DIR) → Alvo[]`, com `token` = `WEBHOOK_TOKEN` do `.env`
  - `enviarHttp(alvo, caminho, corpo: string) → Promise<{status, corpo}>`, com `X-Webhook-Token`; rejeita em erro ou timeout
  - `tratarWebhook(corpo: string, alvos, enviar = enviarHttp) → Promise<void>`

- [ ] **Step 1: Testes que falham**, com `enviar` falso:
  - repassa a todos, sem consultar: texto "1", "oi", `fromMe: true`, evento diferente de `message`, corpo não JSON (Review Focus 3)
  - "3" com total 0 ou 1: consulta todos e repassa o corpo original a todos
  - "2" com 2 no mesmo salão, e com 1 em cada de dois: nenhum repasse; um único `/ambiguo`, com itens `{salao, contato, inicio, servico}` ordenados por `inicio`, enviado ao primeiro salão que tem horário
  - `" 3\n"` com total 2: não repassa (Review Focus 4)
  - salão que rejeita, devolve 404 (versão antiga) ou 200 com `"<html>"`: ignorado, decide com os demais e loga o slug (Review Focus 2)
  - primeiro `/ambiguo` responde 500: tenta o próximo salão com horário; nunca repassa, mesmo se todos falharem (Review Focus 5)
  - `alvosCentral` em pasta temporária: lê o token, remove comentário na linha, ignora `_template` e quem não é `central`; avisa no log, sem mostrar valores, quando falta o token
  - `enviarHttp` contra um servidor em `127.0.0.1`: o cabeçalho chega com o token
- [ ] **Step 2:** rodar e ver falhar.
- [ ] **Step 3:** implementar. Consultas em paralelo (`Promise.allSettled`). O `200` ao WAHA continua imediato.
- [ ] **Step 4:** suíte inteira passa.
- [ ] **Step 5:** commit `Distribuidor consulta pendentes antes de repassar 2/3`.

### Task 4: Todo cliente tem senha

**Files:**
- Modify: `painel/lib/criar.js`, `painel/.dockerignore`, `scripts/novo-cliente.sh`, `clientes/_template/.env`
- Create: `painel/lib/tokens-webhook.js`, `painel/gerar-tokens-webhook.js`, `painel/__tests__/tokens-webhook.test.js`

**Interfaces:**
- Consumes: `novoSegredo()` de `lib/agenda-links`, `parseEnv`/`updateEnv` de `lib/env`, `listar`/`dirCliente` de `lib/clientes`.
- Produces: `completarTokens({ simular }) → { alterados: string[], semToken: string[] }` (`semToken` = quem continua sem token ao final).

- [ ] **Step 1: Testes que falham** (`PROJETO_RAIZ` temporário, com cópia do molde):
  - `criar()` grava `WEBHOOK_TOKEN` com 64 caracteres hex, diferente entre dois clientes
  - `completarTokens` cria só para quem não tem; token existente fica igual; o resto do `.env` não muda; rodar de novo não altera nada
  - com `simular: true`, nenhum arquivo muda e `semToken` lista quem falta
- [ ] **Step 2:** rodar e ver falhar.
- [ ] **Step 3:** implementar. O molde ganha `WEBHOOK_TOKEN=` com comentário na linha de cima. O `novo-cliente.sh` preenche com `head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n'`. O script mostra só slugs, aceita `--simular`, lista quem precisa de `up -d --force-recreate` e sai com código 1 se, fora da simulação, sobrar alguém sem token.
- [ ] **Step 4:** no `painel/.dockerignore`, acrescentar `.env.*` e `**/.env.*`.
- [ ] **Step 5:** rodar a suíte do painel (o que não rodar no Windows por causa do `better-sqlite3`, registrar). Testar a linha do `.sh` numa cópia do molde no scratchpad e conferir LF com `git ls-files --eol`.
- [ ] **Step 6:** commit `Todo cliente nasce com token de webhook`.

### Task 5: Documentação e roteiro de publicação

**Files:** Modify: `docs/DOCUMENTACAO-SLOTME.md` (§8.4 e §8.5), `CLAUDE.md`

- [ ] **Step 1:** documentar o token, a regra da resposta ambígua e a seção "Publicação" do desenho, com os comandos completos (prefixo `sudo env DOCKER_CONFIG=/DATA/.docker`), incluindo rebuild do `painel-slotme:v1`, o script com `--simular`, o distribuidor antes dos salões, a conferência do webhook no WAHA e o teste de 403.
- [ ] **Step 2:** conferir cada comando contra os `docker-compose.yml` (nomes e pastas).
- [ ] **Step 3:** commit `docs: webhook protegido e resposta ambígua`.

### Task 6: Verificação final

- [ ] Suítes completas de `app/` e `painel/` no worktree.
- [ ] `git diff origin/main --stat`: nenhum `.env` real, banco, foto, `credentials.json`, `.reversa/` ou `_reversa_sdd/`.
- [ ] Revisão do diff inteiro da branch.
- [ ] Relatar e **pedir OK antes do push**.
