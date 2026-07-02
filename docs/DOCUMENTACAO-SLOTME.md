# SlotMe — Documentação Oficial

| Campo | Valor |
|---|---|
| **Produto** | SlotMe — SaaS de agendamento para salões (manicure, barbearia, etc.) |
| **Infra** | ZimaOS (Docker) em `192.168.1.100` + Cloudflare Tunnel |
| **Domínio** | `agendamentos.app.br` (subdomínios por cliente; ex-`deadzone.com.br`, migrado em 2026-06) |
| **Repo** | `github.com/Parllon/Agenda_de_Servicos` (branch `main`) |
| **Última atualização** | 2026-06-27 |

> **Como ler:** se só quer colocar um cliente novo no ar, vá direto para a seção
> **5. Manual: adicionar um cliente novo**. O resto é referência.

---

## 1. Visão Geral

### 1.1 O que é

Sistema de agendamento online para salões de beleza. O cliente final acessa uma landing page, escolhe profissional → serviço → horário → preenche os dados → confirma. O sistema:

1. Consulta os horários **realmente livres** no Google Calendar do profissional (`freeBusy`);
2. Cria o evento no Calendar ao confirmar, bloqueando o horário;
3. Dispara uma **confirmação por WhatsApp** para o cliente (fire-and-forget, sem travar a tela);
4. Avisa o salão/profissional via **Telegram**;
5. Envia **lembretes automáticos** na véspera (às 21h) e ~1h antes, com opção de confirmar / reagendar / cancelar respondendo `1` / `2` / `3` no WhatsApp.

### 1.2 Modelo de negócio

- **Uma instância por cliente** (salão): isolamento total de dados, banco e porta.
- **Um único código** ("motor") serve todos os clientes — o que muda por cliente é a configuração.
- **Google Calendar é a fonte da verdade** dos eventos; o SQLite existe para suportar os lembretes (idempotência).
- **WhatsApp via WAHA self-hosted** (whatsapp-web.js + Chromium): custo marginal ~zero por mensagem (vs. Cloud API que cobra por conversa/template).

### 1.3 Clientes no ar (2026-06-27)

| Slug | Porta | Tema | Status |
|---|---|---|---|
| `bya` | 8090 | tema_1 | Em produção |
| `navalha_de_ouro` | 8091 | tema_2 | Ativo |
| `julia_macedo` | 8092 | — | Ativo |
| `studio_beleza` | 8095 | — | Ativo |

**Pendências críticas:**
- **Julia** (2ª prof. da Bya), **Rafael** e **Diego** (Navalha) têm `calendar_id` placeholder → horários aparecem mas a confirmação falha. Precisa de agenda Google real compartilhada com a service account.
- Erro 463 (NackCallerReachoutTimelocked): clientes que nunca enviaram mensagem para o número central 5521984156366 não recebem o WhatsApp de confirmação. Solução: pedir que o cliente envie uma mensagem primeiro para o número. Não é bug de código — é restrição de conta no servidor da Meta.

---

## 2. Arquitetura

### 2.1 Separação código × configuração

A decisão central: **o código nunca sabe qual cliente está servindo**. Quem define o cliente é o ambiente:

| Camada | Localização | O que tem | Quem muda |
|---|---|---|---|
| **Motor** | `/app` | Todo o código Node.js | Você, ao corrigir bugs / adicionar features |
| **Config do cliente** | `/clientes/<slug>` | `.env`, `dados.json`, `fotos/`, `banco_dados/` | Ao onboarbar / ajustar um cliente |
| **WhatsApp global** | `/waha` | WAHA (container Docker) | Raramente — só para reconectar sessão |

Benefício: corrigiu um bug → rebuild da imagem uma vez → **todos os clientes recebem a correção**.

### 2.2 Estrutura de pastas

```
~/Agendamento/
├── waha/                       # WhatsApp central (WAHA — devlikeapro/waha)
│   ├── docker-compose.yml      # porta 21465 externa, rede agenda-net
│   └── sessions/               # sessão persistida (NÃO versionar — fora do Git)
│
├── app/                        # O MOTOR — buildado como motor-agendamento:v1
│   ├── public/                 # frontend (index.html, app.js, styles.css, fotos/)
│   ├── server.js               # API Express + webhook WhatsApp
│   ├── db.js                   # setup SQLite + migrações seguras
│   ├── google.js               # cliente Google Calendar (JWT/Service Account)
│   ├── whatsapp.js             # envio com comportamento humano anti-ban
│   ├── telegram.js             # avisos internos (salão + profissional)
│   ├── mensagens.js            # textos com variações (anti-repetição)
│   ├── temas.js                # presets visuais (tema_1 a tema_8)
│   ├── cron-lembretes.js       # lembrete relativo + véspera
│   ├── seed.js                 # popula banco a partir do dados.json
│   ├── Dockerfile
│   └── credentials.json        # chave da service account (NÃO versionar)
│
├── clientes/                   # AS INSTÂNCIAS (config, zero código)
│   ├── _template/              # MOLDE — copiado por novo-cliente.sh
│   │   ├── .env
│   │   ├── dados.json
│   │   ├── docker-compose.yml
│   │   └── fotos/
│   ├── bya/                    # porta 8090, tema_1
│   │   ├── .env
│   │   ├── dados.json
│   │   ├── docker-compose.yml
│   │   ├── banco_dados/        # SQLite isolado (NÃO versionar)
│   │   └── fotos/              # fotos dos profissionais (NÃO versionar)
│   └── navalha_de_ouro/        # porta 8091, tema_2
│
├── novo-cliente.sh             # cria a estrutura de um cliente novo
├── atualizar-cliente.sh        # up + seed + restart de um cliente
├── .gitignore
└── .gitattributes              # garante LF nos .sh (Linux não aceita CRLF)
```

### 2.3 Como as peças se conectam

- **Imagem única:** `app/Dockerfile` → `motor-agendamento:v1`. O `docker-compose.yml` de cada cliente **não faz build** — apenas referencia essa imagem.
- **Rede `agenda-net`:** rede Docker externa compartilhada. Permite que o motor acesse o WAHA pelo nome `waha`, e que o WAHA acesse o webhook-dispatcher pelo mesmo nome de container.
- **Tema:** a variável `TEMA` no `.env` do cliente escolhe o visual (`tema_1` a `tema_8`). O `server.js` injeta as variáveis CSS no `<head>` — nenhuma classe HTML muda, só os valores.
- **Ficha do cliente (`dados.json`):** fonte única dos dados. O `seed.js` lê dela para popular o banco; o `server.js` lê o bloco `negocio` para o frontend.
- **Cloudflare Tunnel:** porta externa única por cliente → subdomínio próprio.

### 2.4 Por que SQLite além do Google Calendar?

O cron de lembretes precisa marcar quais lembretes já foram enviados (idempotência). O Calendar não oferece esse campo. A coluna `lembrete_enviado` no SQLite resolve isso sem depender de outro servidor de banco.

### 2.5 Por que WAHA (self-hosted) e não WhatsApp Cloud API?

A Cloud API cobra por conversa/template — corrói a margem à medida que o volume cresce. Com o WAHA rodando no ZimaOS, o custo marginal por mensagem é praticamente zero. O trade-off: a sessão expira se o celular ficar sem internet, e novos contatos que nunca enviaram mensagem para o número ficam bloqueados (erro 463 da Meta — ver §1.3 e §8.2).

---

## 3. Stack Técnica

| Componente | Tecnologia |
|---|---|
| Backend / API | Node.js + Express |
| Banco de dados | SQLite (`better-sqlite3`, modo WAL) |
| Frontend | HTML + Tailwind CSS (CDN) + Vanilla JS |
| Integração agenda | Google Calendar API (`googleapis`) via Service Account JWT |
| Integração WhatsApp | WAHA (`devlikeapro/waha`, engine WEBJS — whatsapp-web.js + Chromium) |
| Avisos internos | Telegram Bot API |
| Lembretes | `node-cron` (processo separado do server) |
| Containerização | Docker + Docker Compose |
| Publicação | Cloudflare Tunnel (HTTPS automático, sem abrir portas no roteador) |

---

## 4. Referência de Configuração

### 4.1 `.env` do cliente (completo)

```env
# --- Identidade do container ---
CLIENTE=bya                                       # slug único (sem espaço)
PORTA_EXTERNA=8090                                # porta única no host (8090, 8091, ...)

# --- App ---
PORT=3000
TIMEZONE=America/Sao_Paulo
TIMEZONE_OFFSET=-03:00

# --- Tema visual e perfil do profissional ---
TEMA=tema_1                                        # tema_1..tema_8 (ver temas.js / seção 10)
PERFIL_PROFISSIONAL=profissional                   # profissional | barbeiro | terapeuta | cabeleireiro | designer | tatuador | especialista

# --- Expediente e grade de horários ---
EXPEDIENTE_INICIO=9                               # hora de abertura (inteiro)
EXPEDIENTE_FIM=19                                 # hora de fechamento (inteiro)
FOLGAS=0                                          # dias sem atendimento (0=dom, 1=seg...)
                                                  # "0,6" = dom+sáb; vazio = abre tudo
SLOT_STEP_MIN=30                                  # de quanto em quanto min um serviço PODE começar
JANELA_DIAS=30                                    # dias à frente disponíveis para agendar
ANTECEDENCIA_AGENDAMENTO_MIN=120                  # antecedência mínima p/ marcar (min); 120 = só horários a partir de agora+2h; 0 desliga

# --- Caminhos (dentro do container — não mudar) ---
CAMINHO_DADOS_JSON=/cliente/dados.json
DB_PATH=/data/agendamentos.db

# --- Google Calendar ---
# (credentials.json montado pelo docker-compose.yml — não precisa de var aqui)

# --- WhatsApp: modo de envio (ver §8.5) ---
WHATSAPP_MODE=central                             # central (todos via WAHA) | desativado
WHATSAPP_INSTANCE_CENTRAL=agendamento             # sessão WAHA; só usada se WHATSAPP_MODE=central
WHATSAPP_PREFIXO_NOME=true                        # true = prefixa "[Label] " na mensagem (modo central)
WHATSAPP_PREFIXO_LABEL=Bya                        # texto do prefixo; vazio = usa o slug CLIENTE

# --- WAHA (WhatsApp HTTP API — self-hosted) ---
WAHA_URL=http://waha:3000                         # hostname na rede agenda-net
WAHA_API_KEY=slotme-waha-2026                     # X-Api-Key do WAHA (definida no docker-compose do waha/)
WAHA_SESSION=agendamento                          # nome da sessão pareada no WAHA

# --- WhatsApp: aviso interno à dona (instância dedicada, só envio — ver §8.7) ---
WHATSAPP_INSTANCE_AVISOS=                         # instância que envia avisos à dona; vazio = usa a de envio

# --- Anti-ban (valores de produção — não reduzir) ---
ENVIO_DELAY_MIN_MS=3000                           # pausa antes de enviar (ms)
ENVIO_DELAY_MAX_MS=12000
ENVIO_DIGITANDO_MIN_MS=1500                       # tempo "digitando..." (ms)
ENVIO_DIGITANDO_MAX_MS=4000
ENVIO_LOTE_MIN_MS=30000                           # intervalo entre msgs em lote (ms)
ENVIO_LOTE_MAX_MS=120000
ENVIO_HORA_INICIO=8                               # não envia antes desse horário
ENVIO_HORA_FIM=21                                 # não envia depois desse horário

# --- Lembretes ---
LEMBRETE_VESPERA_HORA=21                          # hora do lembrete da véspera
ANTECEDENCIA_MIN=60                               # quantos min antes o lembrete relativo dispara

# --- Produção ---
LANDING_URL=https://bya.agendamentos.app.br       # usado no link de reagendamento
CORS_ORIGIN=https://bya.agendamentos.app.br       # vazio = libera tudo (só em dev local)

# --- Telegram (avisos internos ao salão) ---
TELEGRAM_BOT_TOKEN=<token do bot>                 # vazio = Telegram desativado
```

> Os chat IDs do Telegram (salão e por profissional) ficam no `dados.json`, não no `.env`.

### 4.2 `dados.json` (estrutura)

```json
{
  "negocio": {
    "nome": "Nome do Salão",
    "subtitulo": "Nail Designer",
    "cidade": "Rio de Janeiro",
    "telefone": "5521999998888",
    "whatsapp_contato": "",         // nº do link "fale com a gente" no rodapé (modo central; vazio = usa telefone). Ver §8.6/§11
    "whatsapp_aviso": "",           // WhatsApp da dona que recebe os avisos (vazio = sem aviso por WhatsApp). Ver §8.7
    "telegram_chat_id": "",         // recebe TODOS os agendamentos (vazio = desativado)
    "calendar_central": "",         // Cenário 2: agenda central do salão (vazio = Cenários 1/3). Ver §9.5
    "permitir_dois_servicos": false // true = cliente pode escolher até 2 serviços (2º opcional). Padrão: false. Liga/desliga no Painel Admin
  },
  "mensagens": {
    // Sobrescreve só os tipos que quiser; o resto usa o padrão de mensagens.js.
    // Aceita string (uma frase) ou lista de frases (sorteia na hora do envio).
    // "confirmacao": ["Frase 1 {nome}...", "Frase 2..."]
  },
  "profissionais": [
    {
      "id": 1,
      "nome": "Nome da Profissional",
      "calendar_id": "email-real@gmail.com",    // ID da agenda Google (compartilhada com a SA)
      "subject_email": null,                     // só preencher se usar Domain-Wide Delegation
      "foto_url": "/fotos/nome.jpg",             // caminho relativo à pasta public/ (ou URL)
      "telegram_chat_id": "",                    // recebe só os SEUS agendamentos
      "servicos": [
        { "nome": "Manicure", "duracao_min": 60, "valor": 35.0 }
      ]
    }
  ]
}
```

**Marcadores disponíveis nas mensagens customizadas:**
`{nome}` `{servico}` `{profissional}` `{data}` `{hora}` `{link}`

**Tipos de mensagem customizáveis:**
`confirmacao` · `vespera` · `lembrete1h` · `reagendar` · `confirmado` · `cancelado`

### 4.3 `docker-compose.yml` do cliente

Cada cliente tem seu próprio `docker-compose.yml` que **não faz build** — usa a imagem `motor-agendamento:v1`. Sobe dois containers: `<slug>-app` (API + frontend) e `<slug>-cron` (lembretes). Os dois volumes principais:
- `./banco_dados:/data` → SQLite persistente no host
- `./dados.json:/cliente/dados.json:ro` → ficha do cliente (read-only dentro do container)

---

## 5. Manual: adicionar um cliente novo (do zero ao ar)

> **Antes de qualquer comando:** preencha o `CHECKLIST-NOVO-CLIENTE.md` com os dados
> do cliente. Ele lista todas as perguntas obrigatórias e opcionais que você precisa
> ter respondidas antes de começar a configurar.

### Pré-requisitos (verificar uma vez)
- Imagem `motor-agendamento:v1` construída.
- Rede `agenda-net` criada (`docker network create agenda-net`).
- WAHA no ar e sessão `agendamento` com status **WORKING** (ver §8.1).

### Passo 1 — Criar a estrutura (1 comando)

```bash
cd ~/Agendamento
sudo ./novo-cliente.sh <slug> <porta> <tema> [perfil]
# Exemplo: sudo ./novo-cliente.sh carol 8092 tema_4 cabeleireiro
# perfil é opcional — padrão: profissional
```

Copia o `_template`, configura o `.env` e cria `banco_dados/` e `fotos/`.

> **A porta tem que ser única.** Porta repetida = Docker recusa subir. Bya=8090, Navalha=8091 → a próxima disponível começa no 8092.

### Passo 2 — Preencher a ficha do cliente

Edite `clientes/<slug>/dados.json` com os dados reais:
- `negocio`: nome, subtítulo, cidade, telefone, `telegram_chat_id` (se quiser avisos de salão).
- `profissionais`: para cada um, `nome`, `calendar_id` (obtido no Passo 3), `foto_url` e a lista de `servicos`.
- Coloque as fotos em `clientes/<slug>/fotos/` — o nome do arquivo precisa bater com o `foto_url`.

### Passo 3 — Google Calendar (para gravar os agendamentos de verdade)

Para **cada profissional**:
1. No Google Calendar da profissional: **Configurações da agenda → Compartilhar com pessoas específicas** → adicionar:
   `calendar-bot@agenda-de-servicos-498211.iam.gserviceaccount.com` com **"Fazer alterações nos eventos"**.
2. Pegar o **ID da agenda** (Configurações → "Integrar agenda" → ID da agenda).
   - Agenda principal de Gmail = o próprio e-mail do profissional.
   - Agenda secundária = algo como `...@group.calendar.google.com`.
3. Colar o ID no campo `calendar_id` do profissional no `dados.json`.

> Sem isso, os horários aparecem (a leitura de agenda não compartilhada retorna "tudo livre"), mas a **confirmação falha silenciosamente**. É o erro mais comum.

### Passo 4 — WhatsApp (se o plano incluir)

Todos os clientes usam **modo central** — um único número (WAHA) atende todos. Não é necessário parear número por cliente.

No `.env` do cliente, garanta:
```env
WHATSAPP_MODE=central
WHATSAPP_INSTANCE_CENTRAL=agendamento
WHATSAPP_PREFIXO_NOME=true
WHATSAPP_PREFIXO_LABEL=<Nome do Salão>
WAHA_URL=http://waha:3000
WAHA_API_KEY=slotme-waha-2026
WAHA_SESSION=agendamento
```

No `dados.json`, preencha `negocio.whatsapp_contato` com o número do salão (exibido no rodapé da landing page como link de contato direto).

O webhook-dispatcher já encaminha as respostas (1/2/3) para o container correto — não é preciso configurar nada adicional. Ver **§8.5**.

**Aviso à dona por WhatsApp** (opcional): `negocio.whatsapp_aviso` no `dados.json`. Ver **§8.6**.

### Passo 5 — Telegram (opcional)

1. Crie um bot via `@BotFather` no Telegram → anote o token.
2. Coloque `TELEGRAM_BOT_TOKEN=<token>` no `.env` do cliente.
3. Obtenha o `chat_id` do salão (envie `/start` para o bot e consulte a API) → coloque em `negocio.telegram_chat_id` no `dados.json`.
4. Para avisos por profissional: preencha `telegram_chat_id` de cada profissional no `dados.json`.

### Passo 6 — Subir (1 comando)

```bash
cd ~/Agendamento
sudo ./atualizar-cliente.sh <slug>
```

Faz `up` + `seed` (popula banco a partir do `dados.json`) + `restart`. Ao final mostra a URL de teste (`http://192.168.1.100:<porta>`). Abra e confira o visual e os horários.

### Passo 7 — Cloudflare (colocar no subdomínio)

Ver seção **7. Cloudflare** abaixo. Resumo:

```bash
# 1) DNS (seguro, não derruba nada)
sudo HOME=/DATA/cloudflared /DATA/bin/cloudflared tunnel route dns agendamento <sub>.agendamentos.app.br

# 2) Backup antes de editar (é produção)
sudo cp /etc/cloudflared/config.yml /etc/cloudflared/config.yml.bak

# 3) Editar /etc/cloudflared/config.yml (rota acima do http_status:404) e reiniciar
sudo systemctl restart cloudflared
```

### Passo 8 — Testar

- `https://<sub>.agendamentos.app.br` → abre o site.
- Faz um agendamento completo → evento aparece no Google Calendar e mensagem chega no WhatsApp.
- Responde "1" → confirma (testa o webhook).
- Responde "3" → cancela (testa a remoção do evento do Calendar).

---

## 6. Operação do dia a dia — as 4 regras "mexeu em X"

| Mexeu em... | O que fazer | Comando |
|---|---|---|
| **Código** (qualquer `.js` em `/app`) | Rebuild da imagem + recriar containers de todos os clientes | Ver abaixo |
| **Dados do cliente** (`dados.json`: profissionais, serviços, fotos, telegram) | Up + seed + restart | `sudo ./atualizar-cliente.sh <slug>` |
| **Só textos de mensagem** (seção `mensagens` do `dados.json`) | Só restart (sem seed) | `docker compose restart` (na pasta do cliente) |
| **Só o `.env`** de um cliente | Recriar container (restart não recarrega vars de ambiente) | `docker compose up -d --force-recreate` (na pasta do cliente) |

**Quando mudar o código (`/app`):**

```bash
# 1) Rebuild da imagem única (rodar na pasta /app)
cd ~/Agendamento/app
sudo env DOCKER_CONFIG=/DATA/.docker docker build -t motor-agendamento:v1 .

# 2) Recriar os containers de CADA cliente
cd ~/Agendamento/clientes/bya
sudo env DOCKER_CONFIG=/DATA/.docker docker compose up -d
# ... repetir para navalha_de_ouro, carol.figueira, etc.
```

> **Por que `up -d` e não `restart`?** O `restart` reinicia o container existente sem recarregar a imagem nem as variáveis de ambiente. Para pegar imagem nova ou `.env` novo, o container precisa ser **recriado** — isso é o `up -d`.

---

## 7. Cloudflare Tunnel

### 7.1 Contexto

- **Binário:** `/DATA/bin/cloudflared` (ZimaOS tem `/usr/local/bin` e `/root` somente leitura)
- **Diretório de trabalho:** `/DATA/cloudflared/.cloudflared/`
- **Túnel:** nome `agendamento`, ID `d6f1e2aa-6d7f-49ba-b7c1-6486f80e2b4b`
- **Config ativa (serviço):** `/etc/cloudflared/config.yml` (o `service install` copia para lá)

> Depois de `service install`, editar sempre `/etc/cloudflared/config.yml` — a cópia em `/DATA/cloudflared/` não é lida pelo serviço.

### 7.2 `config.yml` atual

```yaml
tunnel: d6f1e2aa-6d7f-49ba-b7c1-6486f80e2b4b
credentials-file: /DATA/cloudflared/.cloudflared/d6f1e2aa-6d7f-49ba-b7c1-6486f80e2b4b.json

ingress:
  - hostname: agendamento.agendamentos.app.br
    service: http://192.168.1.100:8090           # bya
  - hostname: navalha.agendamentos.app.br
    service: http://192.168.1.100:8091           # navalha_de_ouro
  # adicionar clientes novos AQUI, acima do http_status:404
  - service: http_status:404                     # catch-all obrigatório (sempre no fim)
```

> **YAML é sensível à indentação:** use **espaços**, nunca tab. Um erro aqui derruba o túnel inteiro — por isso faça backup antes de editar.

### 7.3 Adicionar um cliente novo ao Cloudflare

```bash
# 1) DNS (seguro, não toca no túnel)
sudo HOME=/DATA/cloudflared /DATA/bin/cloudflared tunnel route dns agendamento <sub>.agendamentos.app.br

# 2) Backup
sudo cp /etc/cloudflared/config.yml /etc/cloudflared/config.yml.bak

# 3) Editar (adicionar rota acima do http_status:404)
sudo nano /etc/cloudflared/config.yml

# 4) Aplicar e confirmar
sudo systemctl restart cloudflared
sudo systemctl status cloudflared     # deve mostrar "active (running)"
```

**Se algo der errado:**
```bash
sudo cp /etc/cloudflared/config.yml.bak /etc/cloudflared/config.yml
sudo systemctl restart cloudflared
```

### 7.4 Diagnóstico

Se o subdomínio não abre mas o IP:porta sim → problema no Cloudflare (DNS propagando ou ingress errado).
Se o IP:porta também não abre → problema no container. Checar com:
```bash
sudo env DOCKER_CONFIG=/DATA/.docker docker logs --tail 50 <slug>-app
```

---

## 8. WhatsApp (WAHA)

### 8.1 Arquitetura e credenciais

- **Um** container WAHA para todos os clientes (pasta `waha/`, porta externa 21465).
- Engine: **WEBJS** (whatsapp-web.js + Chromium).
- Número pareado: **5521984156366**.
- Sessão: `agendamento`.
- API Key: `slotme-waha-2026` (header `X-Api-Key` em todas as chamadas).
- Dashboard: `http://192.168.1.100:21465/dashboard` — apenas visual; não reflete o estado real da sessão. Use a API para verificar.

**Verificar status da sessão:**
```bash
curl -s http://localhost:21465/api/sessions/agendamento \
  -H 'X-Api-Key: slotme-waha-2026' | grep status
# "status":"WORKING" = OK
```

**Fluxo:**
- **Outbound:** `whatsapp.js` → `POST /api/sendText` no WAHA → WhatsApp.
- **Inbound:** WhatsApp → WAHA webhook → `webhook-dispatcher` → clientes.

### 8.2 Limitação: erro 463 (NackCallerReachoutTimelocked)

O número 5521984156366 **não consegue iniciar conversa** com contatos que nunca mandaram mensagem para ele. A Meta bloqueia com erro 463 (reach-out time-lock). Isso afeta todos os motores não-oficiais (WAHA, Evolution, Baileys…) — não é solucionável em código.

**Solução para clientes que não recebem:** pedir que enviem qualquer mensagem para o número **5521984156366** antes do agendamento. Após a primeira mensagem do cliente, as mensagens automáticas passam normalmente.

### 8.3 WhatsApp LID (@lid)

O WhatsApp migrou o identificador interno de `@c.us` (número de telefone) para `@lid` (ID opaco). O WAHA recebe webhooks com `payload.from` em formato LID (ex.: `247647864668171@lid`). O `server.js` resolve automaticamente: quando `from` termina em `@lid`, chama `GET /api/{session}/contacts/{lid}` no WAHA para obter o número real (`@c.us`). Nenhuma configuração extra necessária.

### 8.4 Webhook (respostas 1/2/3)

O endpoint `POST /webhook-whatsapp` processa:
- `1` → confirma o agendamento (atualiza status no banco + responde ao cliente)
- `2` → reagendar: remove o evento do Calendar + avisa cliente com o link para remarcar
- `3` → cancelar: remove o evento do Calendar + avisa cliente

O WAHA envia o evento `message` a cada mensagem recebida. O **dispatcher** repassa para todos os containers em modo central — só o dono do telefone responde.

### 8.5 Modo central + dispatcher (fan-out)

Um **único número** (5521984156366) atende todos os salões — sem parear número por cliente.

**Envio:** `whatsapp.js` chama o WAHA com a sessão `WHATSAPP_INSTANCE_CENTRAL`. Como todos recebem do mesmo número, a mensagem é prefixada: `WHATSAPP_PREFIXO_NOME=true` + `WHATSAPP_PREFIXO_LABEL` adicionam `[Bya]` etc. O rodapé com `negocio.whatsapp_contato` exibe o link de contato direto do salão (ver §11.2).

**Recebimento:** o WAHA tem **um** webhook (`http://webhook-dispatcher:3000/webhook-whatsapp`). O dispatcher relê os `.env` de todos os clientes a cada mensagem e encaminha para cada `<slug>-app:3000/webhook-whatsapp`. Só o container dono do telefone processa — os outros descartam silenciosamente.

Ativar um cliente no modo central: setar as vars WAHA no `.env` e `WHATSAPP_MODE=central` + `docker compose up -d --force-recreate`. O dispatcher o inclui automaticamente.

**Configurar webhook no WAHA** (já está configurado — apenas para referência):
```bash
curl -X PUT http://localhost:21465/api/agendamento/webhook \
  -H 'X-Api-Key: slotme-waha-2026' \
  -H 'Content-Type: application/json' \
  -d '{"url":"http://webhook-dispatcher:3000/webhook-whatsapp","events":["message"]}'
```

### 8.6 Aviso à dona por WhatsApp

Além do Telegram (§11.3), o salão pode receber os avisos (novo / cancelado / remarcado) no **WhatsApp da dona**:
- **Destino:** `negocio.whatsapp_aviso` no `dados.json` (vazio = desativado).
- O aviso sai pelo mesmo número central, sem o prefixo `[Label]`.
- Telegram e WhatsApp funcionam em paralelo.

### 8.7 Reconectar sessão (QR Code)

Se a sessão expirar (celular sem internet, troca de número etc.):

```bash
# 1) Verificar se realmente caiu
curl -s http://localhost:21465/api/sessions/agendamento \
  -H 'X-Api-Key: slotme-waha-2026' | grep status

# 2) Reiniciar sessão
curl -X POST http://localhost:21465/api/sessions/agendamento/restart \
  -H 'X-Api-Key: slotme-waha-2026'

# 3) Baixar QR (não abre no browser — exige o header X-Api-Key)
curl -H 'X-Api-Key: slotme-waha-2026' \
  http://localhost:21465/api/agendamento/auth/qr \
  -o /DATA/Agendamento/Imagens_contexto/waha-qr.png
# Abrir \\192.168.1.100\Agendamento\Imagens_contexto\waha-qr.png e escanear
```

---

## 9. Google Calendar

### 9.1 Service Account

- **Projeto Google Cloud:** `agenda-de-servicos-498211`
- **E-mail da SA:** `calendar-bot@agenda-de-servicos-498211.iam.gserviceaccount.com`
- **Arquivo:** `app/credentials.json` (montado como volume read-only em todos os containers)

Uma única SA para todos os clientes — não se cria conta por cliente, apenas se compartilha a agenda.

### 9.2 Compartilhar uma agenda com a SA

No Google Calendar do profissional:
**Configurações → Compartilhar com pessoas específicas → Adicionar pessoa →** colar o e-mail da SA → permissão **"Fazer alterações nos eventos"**.

### 9.3 Obter o ID da agenda

**Configurações da agenda → "Integrar agenda" → ID da agenda:**
- Agenda principal de um Gmail = o próprio e-mail do profissional.
- Agenda secundária = string tipo `...@group.calendar.google.com`.

### 9.4 O que acontece sem a agenda compartilhada

A consulta `freeBusy` de uma agenda não compartilhada retorna "sem eventos" — os horários aparecem todos livres. Na confirmação, a inserção do evento falha. O sintoma é: **horário aparece, agendamento parece confirmar, mas o evento nunca aparece no Calendar**.

### 9.5 Cenários de arquitetura de agendas

O sistema suporta três arranjos. A disponibilidade (`freeBusy`) é **sempre** lida só na agenda da profissional — a agenda central é apenas espelho de escrita.

**Cenário 1 — profissional com conta Google própria (sem agenda central)**
A profissional usa a própria conta; o `calendar_id` dela é o e-mail dela ou uma agenda secundária. O sistema grava e lê **apenas** na agenda da profissional. `negocio.calendar_central` ausente/vazio.

**Cenário 2 — conta própria + agenda central da dona**
A dona cria uma agenda separada (ex.: "Salão da Carol"), compartilha com a SA com permissão **"Fazer alterações nos eventos"** (§9.2) e preenche `negocio.calendar_central` com o ID dessa agenda (§9.3). Cada agendamento é gravado em **dois lugares**: na agenda da profissional (como sempre) e na agenda central. A 2ª gravação é resiliente: **uma falha nela não cancela** o agendamento já feito na agenda da profissional (só loga). No cancelamento/reagendamento, a cópia da central também é apagada — por isso o `event_id` da central fica guardado no banco (coluna `agendamentos.google_event_id_central`).

**Cenário 3 — agendas criadas dentro da conta da dona (modelo preferido)**
A dona cria uma agenda por profissional dentro da própria conta, compartilha cada uma com a profissional (só **visualizar**) e com a SA (**editar**). O `calendar_id` de cada profissional aponta para essas agendas. A dona já vê tudo no próprio Google Calendar — **não usar** `calendar_central` aqui (causaria duplicidade). `negocio.calendar_central` ausente.

> Guard de segurança: o sistema só grava na central se `calendar_central` existir **e** for diferente do `calendar_id` da profissional. O log de boot mostra `[boot] Cenário 2 ativo — agenda central: …` quando o campo está preenchido — útil para flagrar um Cenário 3 configurado por engano.

---

## 10. Temas

7 presets em `app/temas.js`:

| Tema | Visual | Fontes | Nicho sugerido |
|---|---|---|---|
| `tema_1` | Fundo marfim, vinho, blush rosé | Fraunces + Jost | Manicure, Nail Designer |
| `tema_2` | Fundo preto quente, dourado | Oswald + Barlow | Barbearia tradicional |
| `tema_3` | Fundo branco esverdeado, verde esmeralda | Cormorant Garamond + Raleway | Spa, Massagem, Estética |
| `tema_4` | Fundo rosado suave, rosa cerise | Playfair Display + Lato | Cabeleireiro, Coloração |
| `tema_5` | Fundo bege quente, caramelo/terracota | Cormorant Garamond + Nunito | Lash, Sobrancelha, Micropig |
| `tema_6` | Fundo preto profundo, vermelho intenso | Bebas Neue + Barlow | Tatuagem, Piercing |
| `tema_7` | Fundo branco pérola, champagne dourado | Cormorant Garamond + Montserrat | Salão premium, Clínica estética |
| `tema_8` | Fundo branco, detalhes preto e cinza | Space Grotesk + Inter | Estúdio, Barbearia moderna, Consultoria |

Cada tema define cores como variáveis CSS (`--c-ivory`, `--c-wine`, etc.) em canais RGB sem vírgula — permite que o Tailwind aplique transparência (`bg-wine/40`). O `server.js` injeta o bloco CSS no `<head>` na primeira carga, evitando "flash" de tema errado.

### Perfis de profissional

O tema define o **visual** (cores, fontes). O **vocabulário** da interface ("Profissional", "Barbeiro", "Terapeuta"…) é configurado de forma independente via `PERFIL_PROFISSIONAL` no `.env`:

| Perfil | Vocabulário na UI |
|---|---|
| `profissional` | Profissional / Serviço |
| `barbeiro` | Barbeiro / Serviço |
| `terapeuta` | Terapeuta / Tratamento |
| `cabeleireiro` | Cabeleireiro / Serviço |
| `designer` | Designer / Serviço |
| `tatuador` | Tatuador / Arte |
| `especialista` | Especialista / Procedimento |

Isso permite combinar qualquer visual com qualquer vocabulário — ex: `tema_3` (verde spa) + `PERFIL_PROFISSIONAL=terapeuta`. Se `PERFIL_PROFISSIONAL` não for definido, usa o padrão `profissional`.

**Para adicionar um tema novo ou ajustar cores:**
1. Edite `app/temas.js`, adicionando `tema_8` (ou o próximo número) no objeto `TEMAS`.
2. Converta as cores hex para canais RGB separados por espaço (ex: `#5C2330` → `92 35 48`).
3. Use `TEMA=tema_8` no `.env` do cliente.

---

## 11. Mensagens Automáticas

### 11.1 Padrão de fábrica × customização por cliente

`mensagens.js` define textos padrão para 6 tipos de mensagem. Cada cliente pode **sobrescrever qualquer tipo** na seção `mensagens` do `dados.json`, sem tocar no código.

Aceita string única ou lista de strings (sorteia na hora do envio — anti-bot):

```json
"mensagens": {
  "confirmado": "Valeu, {nome}! Te espero. 💈",
  "vespera": ["Oi {nome}! Amanhã é dia...", "Lembrando que amanhã..."]
}
```

### 11.2 Tipos e quando são enviados

| Tipo | Quando é enviado |
|---|---|
| `confirmacao` | Imediatamente após o agendamento |
| `vespera` | Às `LEMBRETE_VESPERA_HORA` (padrão 21h) do dia anterior |
| `lembrete1h` | `ANTECEDENCIA_MIN` minutos antes do horário (padrão 60 min) |
| `reagendar` | Quando o cliente responde `2` no lembrete de véspera |
| `confirmado` | Quando o cliente responde `1` no lembrete de véspera |
| `cancelado` | Quando o cliente responde `3` no lembrete de véspera |

> **Rodapé de contato (só no modo central):** em `confirmacao` e `vespera`, o sistema
> anexa automaticamente o nome do salão + link `wa.me` de contato
> (`negocio.whatsapp_contato`, ou `negocio.telefone` se vazio). No modo próprio o cliente
> já conversa com o número do salão, então o rodapé não aparece.

### 11.3 Telegram (avisos ao salão)

O `telegram.js` avisa sobre novo agendamento, cancelamento e remarcação via Telegram. Dois destinos independentes (sem duplicação):
- **Por profissional:** `telegram_chat_id` no `dados.json` de cada profissional — recebe só os seus.
- **Do salão/dona:** `negocio.telegram_chat_id` no `dados.json` — recebe todos.

O `TELEGRAM_BOT_TOKEN` no `.env` do cliente ativa o recurso. Deixar vazio = Telegram desativado sem efeito colateral.

> O **mesmo aviso** pode sair por **WhatsApp** para a dona (`negocio.whatsapp_aviso`), em
> paralelo ao Telegram — ver **§8.7**.

---

## 12. Troubleshooting

| Sintoma | Causa mais provável | Solução |
|---|---|---|
| `requires exactly 1 argument` no `docker build` | Faltou o `.` no fim do comando | `docker build -t motor-agendamento:v1 .` |
| `mkdir /root/.docker: read-only file system` | Faltou o `DOCKER_CONFIG` | Prefixar com `sudo env DOCKER_CONFIG=/DATA/.docker docker ...` |
| `Permission denied` em qualquer comando | Faltou `sudo` | Adicionar `sudo` |
| WhatsApp **não entrega** para um contato específico | Erro 463 (reach-out time-lock): contato nunca enviou mensagem primeiro | Pedir que o cliente envie qualquer mensagem para 5521984156366 antes de agendar (ver §8.2) |
| WAHA retorna **401** | `WAHA_API_KEY` ausente ou incorreta no `.env` do cliente | Confirmar que `WAHA_API_KEY=slotme-waha-2026` + `up -d --force-recreate` |
| WAHA retorna **404** na sessão | Sessão `agendamento` não existe ou não iniciou | `POST /api/sessions/agendamento/restart` (ver §8.7) |
| Webhook não recebe respostas `1/2/3` | WAHA não tem webhook configurado, ou dispatcher não está no ar | Verificar webhook via `GET /api/agendamento/webhook` e dispatcher com `docker logs webhook-dispatcher` |
| Dashboard WAHA mostra "0 sessions" | Bug cosmético do dashboard — não afeta funcionamento | Ignorar; verificar estado real via `GET /api/sessions/agendamento` (ver §8.1) |
| Horário aparece mas **confirmação falha** | `calendar_id` placeholder ou agenda não compartilhada com a SA | Compartilhar agenda real com a SA + corrigir o `calendar_id` + `atualizar-cliente.sh` |
| Script `.sh` → `bad interpreter` no Linux | Arquivo salvo com fim de linha CRLF (Windows) | `.gitattributes` garante LF; se já corrompido: `sed -i 's/\r//' arquivo.sh` |
| `up` recusa por porta | `PORTA_EXTERNA` repetida com outro cliente | Usar porta única |
| Subdomínio não abre, mas IP:porta abre | DNS propagando ou rota errada no `config.yml` | Esperar 1–2 min / conferir `config.yml` (ver seção 7) |
| Frontend desatualizado no navegador / Cloudflare | Cache do navegador ou da Cloudflare | Navegador: `Ctrl+Shift+R` · Cloudflare: painel → Caching → Purge Everything |
| Profissional sem foto (mostra inicial) | Extensão ou capitalização do arquivo diferente do `foto_url` | Alinhar nome do arquivo com o `foto_url` no `dados.json` e rodar `atualizar-cliente.sh` |

---

## 13. Manutenção Recorrente

| Item | Prazo / Frequência | Ação |
|---|---|---|
| **Sessão WAHA** | Se o celular ficar offline por muito tempo | Verificar status via `GET /api/sessions/agendamento`. Se não estiver `WORKING`, reconectar via QR (ver §8.7). |
| **Backup dos bancos** | Periódico | Copiar `clientes/*/banco_dados/` para local seguro. Perder isso = perder o histórico e as flags de lembrete enviado de todos os clientes. |
| **App do WhatsApp no celular** | Manter atualizado | Manter o app atualizado no celular pareado — versão desatualizada pode encerrar a sessão WAHA. |
| **Fotos dos profissionais** | Sempre que adicionar / trocar | `clientes/*/fotos/` não está no Git — fazer backup separado. |
| **Git** | Antes de cada commit | `git status` para confirmar que `.env`, `credentials.json`, `banco_dados/`, `dados.json` reais e `fotos/` **não aparecem** na lista. |

---

## 14. Referência Rápida de Comandos

```bash
# ===== IMAGEM (sempre que mudar código em /app) =====
cd ~/Agendamento/app
sudo env DOCKER_CONFIG=/DATA/.docker docker build -t motor-agendamento:v1 .

# ===== CLIENTE NOVO =====
cd ~/Agendamento
sudo ./novo-cliente.sh <slug> <porta> <tema> [perfil]  # cria estrutura
# (editar dados.json + fotos + configurar Calendar + WhatsApp)
sudo ./atualizar-cliente.sh <slug>               # up + seed + restart

# ===== OPERAÇÃO (na pasta do cliente) =====
# Mudou dados.json (profissionais/serviços/fotos/telegram):
sudo env DOCKER_CONFIG=/DATA/.docker ./atualizar-cliente.sh <slug>  # de ~/Agendamento

# Mudou só textos de mensagem (seção "mensagens" do dados.json):
sudo env DOCKER_CONFIG=/DATA/.docker docker compose restart

# Mudou só .env:
sudo env DOCKER_CONFIG=/DATA/.docker docker compose up -d --force-recreate

# Ver logs de um cliente:
sudo env DOCKER_CONFIG=/DATA/.docker docker logs --tail 50 <slug>-app
sudo env DOCKER_CONFIG=/DATA/.docker docker logs --tail 50 <slug>-cron

# ===== CLOUDFLARE =====
# Novo subdomínio (DNS):
sudo HOME=/DATA/cloudflared /DATA/bin/cloudflared tunnel route dns agendamento <sub>.agendamentos.app.br

# Editar ingress (sempre fazer backup antes):
sudo cp /etc/cloudflared/config.yml /etc/cloudflared/config.yml.bak
sudo nano /etc/cloudflared/config.yml
sudo systemctl restart cloudflared
sudo systemctl status cloudflared

# ===== WAHA =====
# Verificar sessão:
curl -s http://localhost:21465/api/sessions/agendamento -H 'X-Api-Key: slotme-waha-2026' | grep status

# Reiniciar sessão (se não estiver WORKING):
curl -X POST http://localhost:21465/api/sessions/agendamento/restart -H 'X-Api-Key: slotme-waha-2026'

# Baixar QR para reconectar:
curl -H 'X-Api-Key: slotme-waha-2026' http://localhost:21465/api/agendamento/auth/qr \
  -o /DATA/Agendamento/Imagens_contexto/waha-qr.png

# ===== GIT =====
git status                   # conferir que não há segredos/fotos na lista
git add <arquivos>           # preferir arquivos específicos ao invés de -A
git commit -m "mensagem"
git push
```

---

## 15. Painel Admin (uso interno)

### 15.1 O que é

Um painel web **privado** (`painel/`) para criar e editar clientes por formulário, sem
abrir o código nem editar `dados.json`/`.env` à mão. Lista os clientes, deixa editar
tudo (negócio, profissionais, serviços, mensagens, tema, expediente…) e tem um botão
**Aplicar** que roda `up + seed + restart` (o mesmo que `atualizar-cliente.sh`) com 1 clique.

> **É uma ferramenta de administração com acesso ao Docker do host.** Por isso roda
> **só na LAN** (`192.168.1.100:8099`), **fora do Cloudflare**, e atrás de senha.
> Nunca adicione o painel ao `config.yml` do túnel.

### 15.2 Arquitetura

- Serviço separado do motor (o motor só conhece o próprio cliente; o painel precisa ver
  **todos**). Imagem própria `painel-slotme:v1`, com `docker` CLI + plugin compose dentro
  (para conseguir aplicar os clientes via socket).
- Lê/grava direto os arquivos em `clientes/<slug>/dados.json` e `.env`, reaproveitando as
  mesmas regras de validação do `novo-cliente.sh` (tema/perfil/porta/slug) e a sequência
  do `atualizar-cliente.sh` (no `painel/lib/aplicar.js`).

**Caminho do projeto (detalhe importante):** o painel monta o projeto no **mesmo caminho
absoluto do host** (`PROJETO_RAIZ`, ex. `/DATA/Agendamento`). Isso é obrigatório porque o
`docker compose` dos clientes usa caminhos relativos (`./banco_dados`, `../../app/...`) e
quem resolve esses volumes é o daemon do host. Path diferente = mounts quebrados.

### 15.3 Subir o painel (primeira vez)

```bash
cd /DATA/Agendamento/painel       # ajuste se a raiz do projeto for outra

# 1) configurar segredos
cp exemplo.env .env
nano .env                         # ajustar PROJETO_RAIZ, PAINEL_SENHA, PAINEL_COOKIE_SECRET

# 2) build da imagem do painel
sudo env DOCKER_CONFIG=/DATA/.docker docker build -t painel-slotme:v1 .

# 3) subir
sudo env DOCKER_CONFIG=/DATA/.docker docker compose up -d
```

Acesse em `http://192.168.1.100:8099` (na sua rede local), entre com a `PAINEL_SENHA`.

### 15.4 Uso no dia a dia

- **Editar um cliente:** clicar *Editar* → mexer no formulário → *Salvar* (grava arquivos)
  ou *Salvar e aplicar* (grava + roda seed/restart).
- **Criar um cliente:** *+ Novo cliente* → preencher slug, porta, tema/perfil e dados →
  *Salvar* (cria a pasta a partir do `_template`) → depois *Aplicar*. Lembre que Google
  Calendar, WhatsApp e Cloudflare ainda são passos manuais (seções 9, 8 e 7).
- **Aplicar:** o botão mostra o log do `seed`/`restart`; erro de agenda/`calendar_id`
  aparece aí (ver §9.4).

> Mudou o **código** do próprio painel (`painel/*.js`)? Rebuild + `up -d` do painel
> (passos 2 e 3 do §15.3). Mudou só dados de cliente pelo painel? O botão *Aplicar* já
> resolve — não precisa tocar no painel.

### 15.5 Limitações da 1ª versão

- Upload de **fotos** não está no painel: o campo é só o `foto_url` (texto). Coloque o
  arquivo em `clientes/<slug>/fotos/` manualmente (ou via pasta de rede).
- Não cria agenda no Google nem instância na Evolution — só a configuração local.
