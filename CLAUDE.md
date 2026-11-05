# CLAUDE.md — contexto do projeto SlotMe

> Este arquivo orienta o Claude Code ao trabalhar neste repositório. Leia antes de
> agir. Detalhes completos estão em `DOCUMENTACAO-SLOTME.md`.

## O que é
SaaS de **agendamento online multi-cliente** para salões (manicure, barbearia, etc.).
Cliente final agenda pelo navegador; o sistema grava no Google Calendar do
profissional e manda confirmação/lembrete por WhatsApp. Objetivo de negócio:
revender o mesmo sistema para vários salões.

## Quem mantém e como falar
Dono: **Parllon** — está aprendendo a programar com este projeto. Responder em
**português**, tom de sócio técnico honesto, **explicar o porquê**, um passo de cada
vez, e sinalizar trade-offs. Validar boas ideias; discordar com respeito quando
necessário. Não assumir conhecimento avançado de Docker/Linux.

## Ambiente (importante)
- **Edição:** Windows (VS Code), numa cópia local do repo em
  `C:\Projetos\Agenda_de_Servicos` (clone de `github.com/Parllon/Agenda_de_Servicos`).
  Fluxo: editar → commit → push de lá. **Não editar mais pela pasta de rede**
  `\\192.168.1.100\Agendamento` (deixou de ser o jeito certo).
- **Execução:** servidor **ZimaOS (Linux)** em `192.168.1.100`, pasta `~/Agendamento`.
  Antes de aplicar qualquer mudança, `git pull` nessa pasta no SSH do Zima. Os
  comandos Docker/git de verdade rodam **no terminal SSH do Zima**.
- Se este agente roda no Windows: consegue ler/editar arquivos na cópia local e
  fazer commit/push, mas **não** alcança o Docker do Zima — os comandos de
  deploy (`git pull` + rebuild/restart) o Parllon roda no SSH do Zima.

## Arquitetura
Separação **código vs. configuração**:
- `/app` — o "motor": todo o código Node. Vira a imagem única `motor-agendamento:v1`
  (build feito UMA vez). Corrigiu bug → reconstrói a imagem → todos os clientes pegam.
- `/clientes/<slug>` — cada cliente é só config: `.env` (infra+tema), `dados.json`
  (ficha: negócio, profissionais, serviços, mensagens), `fotos/`, `banco_dados/`.
  Container, banco e porta próprios = isolamento total.
- `/clientes/_template` — molde copiado para cada cliente novo.

## Stack
Node + Express; **SQLite** (better-sqlite3, modo WAL); frontend HTML + Tailwind (CDN) +
JS puro servido pelo Express; Google Calendar via 1 service account compartilhada
(`calendar-bot@agenda-de-servicos-498211.iam.gserviceaccount.com`, arquivo
`app/credentials.json`); avisos internos via Telegram.
Tudo em Docker. Túnel Cloudflare `agendamento` (domínio `agendamentos.app.br`).
WhatsApp via **WAHA** (self-hosted, engine WEBJS — whatsapp-web.js + Chromium),
substituiu Evolution API + wa-sender em 2026-06-27. Todos os clientes em
`WHATSAPP_MODE=central`, sessão `agendamento` no container `waha`.

## REGRAS CRÍTICAS (já custaram tempo — não repetir)
1. **Todo comando Docker leva o prefixo** (o `/root` do Zima é read-only):
   `sudo env DOCKER_CONFIG=/DATA/.docker docker ...`
2. **"Mexeu em X" decide o comando:**
   - mexeu em **código** (`/app`) → rebuild da imagem + `up -d` em cada cliente.
   - mexeu em **dados** do cliente (`dados.json`: profissionais/serviços/telegram) →
     `./atualizar-cliente.sh <slug>` (faz up + seed + restart).
   - mexeu só nos **textos** das mensagens (seção `mensagens` do `dados.json`) →
     `docker compose restart` (não precisa seed nem rebuild).
   - mexeu só no **`.env`** → `docker compose up -d --force-recreate` (NÃO `restart`:
     restart não recarrega variáveis de ambiente).
3. **`docker build` precisa do `.` no fim**: `docker build -t motor-agendamento:v1 .`
4. **Porta externa única por cliente** (`PORTA_EXTERNA`). Bya=8090, Navalha=8091...
5. **WhatsApp:** `WHATSAPP_MODE=central` em todos os clientes, via **WAHA** (`/waha`,
   sessão `agendamento`). Se a sessão cair, reconectar: `POST /api/sessions/agendamento/restart`
   (+ QR se não recuperar sozinho — ver §8.7 da `DOCUMENTACAO-SLOTME.md`).
6. **Google:** o `calendar_id` de cada profissional precisa ser uma agenda **real
   compartilhada** com a service account. Placeholder → horário aparece mas a
   confirmação falha. Dois modelos de como a agenda chega nesse estado:
   - **Antigo (clientes atuais: bya, navalha_de_ouro, julia_macedo, studio_beleza):**
     o dono compartilha a própria agenda com `calendar-bot@...` manualmente
     (§9.2/§9.3 da `DOCUMENTACAO-SLOTME.md`), e cola o ID em `calendar_id`.
   - **Novo (clientes criados pelo wizard `cadastro.*` com o checkbox "Criar
     agendas Google automaticamente" ligado — padrão):** é o inverso — a
     própria service account cria 1 agenda por profissional
     (`painel/lib/agendas.js`) e manda convite pro `negocio.email_dono`; o
     dono só precisa aceitar. O motor (`/app`) não diferencia os dois modelos
     — só lê `calendar_id`, não importa quem criou a agenda.
7. **Scripts `.sh`**: manter fim de linha **LF** (há `.gitattributes`). CRLF do Windows
   quebra no Linux.

## Segurança / Git (repo PRIVADO)
NUNCA versionar: `.env`, `credentials.json`, `*.db*`, `fotos/`, e os `dados.json`
**reais** de cliente (`clientes/*/dados.json`, exceto o `_template`). Tudo isso já está
no `.gitignore`. Antes de qualquer commit, conferir `git status` e garantir que nada
disso aparece. Tokens (WhatsApp/Telegram) vivem só nos `.env`.

## Adicionar um cliente novo (fluxo)
1. `sudo ./novo-cliente.sh <slug> <porta> <tema> [perfil]` (tema: `tema_1` a `tema_8`; perfil: `profissional`, `barbeiro`, `terapeuta`, `cabeleireiro`, `designer`, `tatuador`, `especialista` — padrão: `profissional`).
2. Editar `clientes/<slug>/dados.json` (dados reais) e pôr fotos em `fotos/`.
3. Compartilhar as agendas Google com a service account; pôr os IDs no `dados.json`.
4. WhatsApp (se o plano tiver): criar/conectar a instância no manager + webhook.
5. `sudo ./atualizar-cliente.sh <slug>` (sobe + seed + restart).
6. Cloudflare: criar DNS + adicionar rota no ingress (acima do `http_status:404`).
   Detalhe na seção 6 da `DOCUMENTACAO-SLOTME.md`.

**Automático (cadastro do site SlotMe):** `slotme.agendamentos.app.br/cadastro` faz
`POST cadastro.agendamentos.app.br/api/pedidos` (rota pública do painel). O painel valida
(`painel/lib/pedido.js`), registra em `painel/pedidos/<protocolo>.json` (fora do Git) e
cria tudo sozinho numa fila serial (`painel/lib/provisionar.js`): config → agendas Google →
fotos → docker → DNS. Teto `PEDIDOS_MAX_DIA` (padrão 5/24h); acima disso o pedido fica
`aguardando` e é liberado em `POST /api/pedidos/<protocolo>/reprocessar` (com login).
O `.env` do painel precisa de `WAHA_API_KEY` (o `criar.js` copia para o cliente; sem ela
o cliente nasce com a chave placeholder e nenhum WhatsApp sai). `AGENDAS_ADMIN_EMAIL`
(hoje `slotmeagendamentos@gmail.com`) recebe acesso de edição a toda agenda criada pela SA;
para agendas já existentes: `docker exec painel-slotme node compartilhar-admin.js` (pula
agendas pessoais de clientes antigos).

**E-mail do dono: só Gmail ou iCloud** (`@gmail.com`, `@icloud.com`, `@me.com`, `@mac.com`) —
validado no site e no painel. iCloud não abre o convite do Google, então usa a **agenda por
assinatura**: `AGENDA_ICS_SEGREDO` no `.env` do cliente liga `GET /agenda/<token>.ics` (lê o
Google pela SA) e a página `/assinar/<token>` (botão webcal:// do iPhone). Links por dono e por
profissional: tela de edição do cliente no painel. O motor responde o "oi" do dono (protocolo
`CADASTRO_PROTOCOLO` no texto) com o link da página + agenda. Clientes antigos sem segredo:
`docker exec painel-slotme node gerar-segredos-agenda.js` + `up -d --force-recreate` neles. Código do site:
`C:\Users\parll\Projetos_Pages\Site_agendamentos` (contrato em `src/lib/cadastro/pedido.js`).

**Métricas** (`painel/lib/metricas.js`, coletor público `painel/lib/coletor.js`): `POST /api/evento`
aceita JSON ou `text/plain` com JSON (≤2 KB), token `METRICS_TOKEN`, tipos em lista fechada
(`TIPOS_EVENTO`) e slugs = pastas de cliente + `METRICS_SLUGS_EXTRAS` (padrão `slotme_lp`).
Contagens são por pessoa (`COUNT(DISTINCT sessao_id)`); filtro de datas em horário de São Paulo
(`criado_em` é UTC). Testes do painel: `npm test` (Jest) — rodar num container `node:22` no Zima
(o `better-sqlite3` 9.x não compila no Node 24 do Windows).

## Features configuráveis por cliente
- **Tema** (`.env` `TEMA`): cores em `app/temas.js` (canais RGB "R G B"). 8 presets:
  `tema_1` (vinho/marfim), `tema_2` (preto/dourado), `tema_3` (verde/branco),
  `tema_4` (rosa/branco), `tema_5` (nude/caramelo), `tema_6` (preto/vermelho),
  `tema_7` (pérola/champagne), `tema_8` (branco/preto/cinza). Cor nova = converter hex→RGB.
- **Perfil do profissional** (`.env` `PERFIL_PROFISSIONAL`): vocabulário da interface,
  independente do tema. Opções: `profissional` (padrão), `barbeiro`, `terapeuta`,
  `cabeleireiro`, `designer`, `tatuador`, `especialista`. Definido em `app/temas.js`
  no objeto `PERFIS`; fallback automático para `profissional` se não definido.
- **Telegram** (avisos ao salão): `TELEGRAM_BOT_TOKEN` no `.env`; chat do salão em
  `negocio.telegram_chat_id` (recebe tudo) e por profissional em `telegram_chat_id`
  (recebe os seus). Avisa novo agendamento, cancelamento e remarcação.
- **Mensagens** (textos de WhatsApp): padrão em `app/mensagens.js`; cada cliente
  sobrescreve o que quiser na seção `mensagens` do `dados.json`. Tipos: `confirmacao`,
  `vespera`, `lembrete1h`, `reagendar`, `confirmado`, `cancelado`. Marcadores:
  `{nome}` `{servico}` `{profissional}` `{data}` `{hora}` `{link}`.

## Estado atual / pendências
- No ar: **bya** (8090), **navalha_de_ouro** (8091), **julia_macedo** (8094), **studio_beleza** (8095).
- **WhatsApp via WAHA** desde 2026-06-27, `WHATSAPP_MODE=central`. Erro 463 (Meta)
  bloqueia envio a contatos que nunca mandaram mensagem primeiro pro número central.
- Fazer backup periódico de `clientes/*/banco_dados/`.

## Comportamento do agente (instruções para o Claude Code)
- **Sempre que uma mudança exigir rebuild**, incluir ao final da resposta o bloco de
  comandos pronto para rodar no SSH do Zima, sem que o Parllon precise pedir:
  ```bash
  cd ~/Agendamento/app
  sudo env DOCKER_CONFIG=/DATA/.docker docker build -t motor-agendamento:v1 .

  cd ~/Agendamento/clientes/bya
  sudo env DOCKER_CONFIG=/DATA/.docker docker compose up -d

  cd ~/Agendamento/clientes/navalha_de_ouro
  sudo env DOCKER_CONFIG=/DATA/.docker docker compose up -d
  # (repetir para outros clientes ativos)
  ```

## Antes de mexer
- Mudança em produção (Bya está no ar) → avisar e ter cuidado; preferir testar em
  instância isolada.
- Não rodar `seed` na Bya sem o `dados.json` dela conferido (reaplica os dados; a
  Julia ainda tem serviços de exemplo).
- Em dúvida sobre comando/estrutura, consultar `DOCUMENTACAO-SLOTME.md`.
