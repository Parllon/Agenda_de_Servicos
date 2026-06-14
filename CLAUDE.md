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
- **Edição:** Windows (VS Code), via pasta de rede `\\192.168.1.100\Agendamento`.
- **Execução:** servidor **ZimaOS (Linux)** em `192.168.1.100`, pasta `~/Agendamento`.
  Os comandos Docker/git de verdade rodam **no terminal SSH do Zima**.
- Se este agente roda no Windows: consegue ler/editar arquivos, mas **não** alcança o
  Docker do Zima — os comandos de deploy o Parllon roda no SSH do Zima.

## Arquitetura
Separação **código vs. configuração**:
- `/app` — o "motor": todo o código Node. Vira a imagem única `motor-agendamento:v1`
  (build feito UMA vez). Corrigiu bug → reconstrói a imagem → todos os clientes pegam.
- `/clientes/<slug>` — cada cliente é só config: `.env` (infra+tema), `dados.json`
  (ficha: negócio, profissionais, serviços, mensagens), `fotos/`, `banco_dados/`.
  Container, banco e porta próprios = isolamento total.
- `/Evolution_Global` — UMA Evolution API (WhatsApp) para todos. Cada cliente tem sua
  instância dentro dela. Containers se falam pela rede Docker externa `agenda-net`.
- `/clientes/_template` — molde copiado para cada cliente novo.

## Stack
Node + Express; **SQLite** (better-sqlite3, modo WAL); frontend HTML + Tailwind (CDN) +
JS puro servido pelo Express; Google Calendar via 1 service account compartilhada
(`calendar-bot@agenda-de-servicos-498211.iam.gserviceaccount.com`, arquivo
`app/credentials.json`); WhatsApp via Evolution API; avisos internos via Telegram.
Tudo em Docker. Túnel Cloudflare `agendamento` (domínio `deadzone.com.br`).

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
5. **WhatsApp:** o código lê a chave de **`WHATSAPP_API_TOKEN`** (= chave da Evolution).
   `WHATSAPP_INSTANCE` precisa bater com o nome da instância no manager. Webhook da
   instância → `http://<slug>-app:3000/webhook-whatsapp` + evento `MESSAGES_UPSERT`.
6. **Google:** o `calendar_id` de cada profissional precisa ser uma agenda **real
   compartilhada** com a service account. Placeholder → horário aparece mas a
   confirmação falha.
7. **Scripts `.sh`**: manter fim de linha **LF** (há `.gitattributes`). CRLF do Windows
   quebra no Linux.

## Segurança / Git (repo PRIVADO)
NUNCA versionar: `.env`, `credentials.json`, `*.db*`, `fotos/`, e os `dados.json`
**reais** de cliente (`clientes/*/dados.json`, exceto o `_template`). Tudo isso já está
no `.gitignore`. Antes de qualquer commit, conferir `git status` e garantir que nada
disso aparece. Tokens (WhatsApp/Telegram) vivem só nos `.env`.

## Adicionar um cliente novo (fluxo)
1. `sudo ./novo-cliente.sh <slug> <porta> <tema> [perfil]` (tema: `tema_1` a `tema_7`; perfil: `profissional`, `barbeiro`, `terapeuta`, `cabeleireiro`, `designer`, `tatuador`, `especialista` — padrão: `profissional`).
2. Editar `clientes/<slug>/dados.json` (dados reais) e pôr fotos em `fotos/`.
3. Compartilhar as agendas Google com a service account; pôr os IDs no `dados.json`.
4. WhatsApp (se o plano tiver): criar/conectar a instância no manager + webhook.
5. `sudo ./atualizar-cliente.sh <slug>` (sobe + seed + restart).
6. Cloudflare: criar DNS + adicionar rota no ingress (acima do `http_status:404`).
   Detalhe na seção 6 da `DOCUMENTACAO-SLOTME.md`.

## Features configuráveis por cliente
- **Tema** (`.env` `TEMA`): cores em `app/temas.js` (canais RGB "R G B"). 7 presets:
  `tema_1` (vinho/marfim), `tema_2` (preto/dourado), `tema_3` (verde/branco),
  `tema_4` (rosa/branco), `tema_5` (nude/caramelo), `tema_6` (preto/vermelho),
  `tema_7` (pérola/champagne). Cor nova = converter hex→RGB.
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
- No ar: **bya** (8090, tema_1, em produção), **navalha_de_ouro** (8091, tema_2).
  Também criados: `carol.figueira`, `barbearia_joao`.
- **Agendas placeholder** (confirmação ainda falha até virar agenda real): a 2ª
  profissional da Bya (**Julia**) e os barbeiros da Navalha (**Rafael**, **Diego**).
- **Telegram e mensagens personalizadas** foram implementados recentemente — conferir
  se já foram pro ar em todos os clientes (rebuild + `up -d`).
- **Manutenção recorrente:** `CONFIG_SESSION_PHONE_VERSION` (em `Evolution_Global/.env`)
  expira ~**02/08/2026** — quando o QR parar, atualizar. E fazer backup periódico de
  `clientes/*/banco_dados/`.

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
