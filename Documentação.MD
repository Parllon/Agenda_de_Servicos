# Documentação Oficial — SlotMe (Sistema de Agendamento)

| Campo | Valor |
|---|---|
| **Produto** | SlotMe — SaaS de agendamento para manicures / salões |
| **Cliente piloto** | Bya Marcondes (Nail Designer · Rio de Janeiro) |
| **Status** | 🟢 **NO AR** em `https://agendamento.deadzone.com.br` |
| **Infra** | Servidor doméstico ZimaOS (Docker) + Cloudflare Tunnel |
| **Repositório** | `github.com/Parllon/Agenda_de_Servicos` (branch `main`) |
| **Sessões cobertas** | 3 (04/06, 06/06, 08–09/06 de 2026) |

---

## 1. Visão Geral (Overview)

### 1.1 Cenário inicial e objetivo

O projeto nasceu da necessidade de oferecer a profissionais autônomas (começando por manicures/nail designers) uma **landing page de agendamento automático** que:

1. Apresenta a profissional, seus serviços e os horários **realmente livres**;
2. Permite ao cliente final escolher profissional → serviço → horário → preencher dados → confirmar;
3. Ao confirmar, **cria o evento no Google Calendar** da profissional e **dispara uma confirmação no WhatsApp** do cliente;
4. **Envia lembretes automáticos** (na véspera às 21h e ~1h antes do horário) via WhatsApp, com opção de Confirmar / Reagendar / Cancelar respondendo com `1` / `2` / `3`.

O objetivo de médio prazo é **comercializar** o sistema para vários salões, cada um com sua própria instância e subdomínio.

### 1.2 Modelo de negócio adotado

- **Uma instância por cliente** (sem multi-tenant nesta fase — decisão consciente para evitar otimização prematura). Cada salão ganha um subdomínio próprio.
- O **Google Calendar é a fonte da verdade** dos eventos; o SQLite local existe apenas para dar suporte ao cron de lembretes (idempotência).
- WhatsApp via **Evolution API auto-hospedada** (não a Cloud API oficial) — decisão tomada pela **margem**: custo marginal próximo de zero por mensagem.

### 1.3 O que está pronto (resumo)

Sistema funcional end-to-end e publicado: agenda real consultada via `freeBusy`, criação de eventos, confirmação e lembretes por WhatsApp com **comportamento humano anti-ban**, frontend personalizado com foto da profissional, navegação por abas, validação de formulário, e publicação segura via Cloudflare Tunnel.

---

## 2. Arquitetura e Stack Tecnológica

### 2.1 Diagrama de arquitetura

```
┌─────────────────┐      HTTPS/REST       ┌──────────────────┐
│  Landing Page   │ ───────────────────>  │   API Node.js    │
│  (Tailwind/JS)  │ <───────────────────  │    (Express)     │
└─────────────────┘                       └────────┬─────────┘
                                                   │
                          ┌────────────────────────┼────────────────────────┐
                          │                        │                        │
                   ┌──────▼──────┐         ┌────────▼────────┐      ┌─────────▼────────┐
                   │   Google    │         │  Gateway        │      │   SQLite         │
                   │  Calendar   │         │  WhatsApp       │      │  (lembretes +    │
                   │    API      │         │  (Evolution)    │      │   estado)        │
                   └─────────────┘         └─────────────────┘      └──────────────────┘
                                                   ▲
                                          ┌────────┴────────┐
                                          │   Cron Job      │
                                          │  (node-cron)    │
                                          └─────────────────┘
```

### 2.2 Componentes e responsabilidades

| Componente | Tecnologia | Responsabilidade |
|---|---|---|
| Backend / API | Node.js + Express | Endpoints de profissionais, serviços, horários e agendamento; webhook do WhatsApp |
| Banco de dados | SQLite (`better-sqlite3`, modo WAL) | Suporte ao cron (flag `lembrete_enviado`), cadastro de profissionais/serviços |
| Integração agenda | `googleapis` (Service Account / JWT) | Consultar `freeBusy`, inserir/excluir eventos |
| Integração WhatsApp | Evolution API (HTTP) | Enviar confirmações/lembretes, receber respostas |
| Lembretes | `node-cron` (processo separado) | Disparo de véspera (21h) e relativo (~1h antes) |
| Frontend | HTML + Tailwind (CDN) + Vanilla JS | Fluxo de 5 passos servido pelo próprio Express |
| Containerização | Docker + Docker Compose | App + Cron + Evolution + Postgres |
| Publicação | Cloudflare Tunnel | Expor a app à internet com HTTPS, sem abrir portas no roteador |

### 2.3 Por que SQLite **além** do Google Calendar?

O cron de lembretes precisa marcar **quais lembretes já foram enviados** para não disparar a mesma mensagem a cada execução. O Calendar não oferece um campo confiável de "lembrete enviado" sob nosso controle. A coluna `lembrete_enviado` resolve isso de forma **idempotente**.

### 2.4 Decisão: Evolution (self-hosted) × WhatsApp Cloud API

Optou-se pela **Evolution API auto-hospedada** em vez da Cloud API oficial. O motivo central é a **margem do negócio**: a Cloud API cobra por conversa/template, o que corrói o lucro à medida que o volume cresce. Com a Evolution rodando no ZimaOS (servidor doméstico 24h, com folga de recursos), o custo marginal por mensagem é praticamente zero. O trade-off assumido é a manutenção (a sessão do WhatsApp Web exige atenção periódica — ver §9).

### 2.5 Estrutura de arquivos do projeto

```
~/Agendamento
├── .env                       ← variáveis de ambiente (NUNCA versionar)
├── credentials.json           ← chave da Service Account (NUNCA versionar)
├── package.json
├── Dockerfile
├── docker-compose.yml         ← stack mínimo (app + cron)
├── docker-compose.full.yml    ← stack completo (app + cron + Evolution + Postgres)
├── .gitignore
├── db.js                      ← setup SQLite + migrações
├── google.js                  ← cliente Google Calendar (JWT)
├── whatsapp.js                ← envio + comportamento humano anti-ban
├── mensagens.js               ← variações de texto das mensagens
├── server.js                  ← API Express + webhook
├── cron-lembretes.js          ← job de lembretes
├── seed.js                    ← popula profissionais + serviços
├── testar-vespera.js          ← script de teste do lembrete de véspera
└── public/
    ├── index.html             ← estrutura + config Tailwind + links
    ├── styles.css             ← estilos custom
    ├── app.js                 ← lógica do frontend
    └── fotos/                 ← fotos das profissionais (NÃO versionado)
```

---

## 3. Linha do Tempo do Projeto

| Sessão | Data | Foco principal | Estado ao final |
|---|---|---|---|
| **1** | 04/06/2026 | Fundação: código completo, Google Calendar, deploy Docker | Funciona end-to-end, **exceto** envio WhatsApp |
| **2** | 06/06/2026 | WhatsApp: Evolution, anti-ban, webhook, Git | WhatsApp entregando; código no GitHub |
| **3** | 08–09/06/2026 | Features (foto, validação, abas), GO-LIVE, correções | **Publicado** e funcional na internet |

---

## 4. SESSÃO 1 — Fundação: Código, Google Calendar e Deploy

> **Objetivo da sessão:** sair do zero e ter o sistema rodando localmente/no Docker, com a integração do Google Calendar funcionando.

### 4.1 Decisão de autenticação Google: OAuth2 × Service Account

A primeira decisão técnica relevante foi **como autenticar no Google Calendar**. Comparação que guiou a escolha:

| Critério | Service Account | OAuth2 (consentimento de usuário) |
|---|---|---|
| Acessa agenda de Google Workspace corporativo | ✅ Com Domain-Wide Delegation | ✅ |
| Acessa agenda de Gmail pessoal | ❌ Não funciona **sem** o profissional compartilhar a agenda manualmente | ✅ |
| Renovação de token | Automática (sem refresh token) | Precisa armazenar e renovar refresh token |
| Complexidade | Menor | Maior |

**Decisão:** usar **Service Account** com o "truque" da **agenda compartilhada** — a profissional compartilha a agenda dela com o e-mail da Service Account (permissão "Fazer alterações nos eventos"). Funciona com Gmail pessoal e dispensa o fluxo OAuth com refresh token.

### 4.2 Passo a passo — criar a Service Account no Google Cloud

1. **Criar o projeto:** acessar o [Google Cloud Console](https://console.cloud.google.com/) → seletor de projetos → **Novo Projeto** (nome usado no projeto: `agenda-de-servicos-498211`).
2. **Ativar a API:** menu lateral → **APIs e Serviços → Biblioteca** → buscar **Google Calendar API** → **Ativar**.
3. **Criar a Service Account:** **APIs e Serviços → Credenciais → Criar credenciais → Conta de serviço**. Nome usado: `calendar-bot`. **Criar e continuar** → pular papéis → **Concluir**.
4. **Gerar a chave JSON:** abrir a conta criada → aba **Chaves → Adicionar chave → Criar nova chave → tipo JSON → Criar**. Baixa um `.json` → renomear para `credentials.json`. Esse arquivo **tem `client_email` e `private_key`** (é assim que se confirma que é uma Service Account e não um OAuth Client).
   - E-mail final da SA: `calendar-bot@agenda-de-servicos-498211.iam.gserviceaccount.com`
5. **Compartilhar a agenda (uma vez por profissional):** no Google Calendar da profissional → **Configurações da agenda → Compartilhar com pessoas específicas** → adicionar o e-mail da SA com permissão **"Fazer alterações nos eventos"**.
6. **Copiar o ID da agenda:** em "Integrar agenda → ID da agenda" (para a agenda principal, costuma ser o próprio e-mail). Esse ID vai no cadastro de profissionais (`calendar_id`).

> ⚠️ **Nunca** versionar o `credentials.json` em repositório público.

### 4.3 Modelo de dados — `db.js`

SQLite com modo WAL (melhor concorrência leitura/escrita) e três tabelas. Trecho essencial:

```js
const Database = require('better-sqlite3');
const db = new Database('agendamentos.db');
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS profissionais (
    id INTEGER PRIMARY KEY,
    nome TEXT NOT NULL,
    calendar_id TEXT NOT NULL,
    subject_email TEXT
  );
  CREATE TABLE IF NOT EXISTS servicos (
    id INTEGER PRIMARY KEY,
    nome TEXT NOT NULL,
    duracao_min INTEGER NOT NULL,
    valor REAL NOT NULL
  );
  CREATE TABLE IF NOT EXISTS agendamentos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    google_event_id TEXT,
    profissional_id INTEGER,
    servico_nome TEXT,
    cliente_nome TEXT,
    cliente_telefone TEXT,            -- E.164 sem '+': 5521999998888
    inicio TEXT NOT NULL,             -- ISO 8601
    fim TEXT NOT NULL,
    status TEXT DEFAULT 'confirmado', -- confirmado | cancelado
    lembrete_enviado INTEGER DEFAULT 0,
    criado_em TEXT DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_ag_lembrete
    ON agendamentos (status, lembrete_enviado, inicio);
`);
module.exports = db;
```

> A coluna `foto_url` em `profissionais` foi adicionada por migração na Sessão 3 (ver §6.5).

### 4.4 Cliente Google Calendar — `google.js` (JWT)

```js
const { google } = require('googleapis');
const fs = require('fs');
const credentials = JSON.parse(fs.readFileSync(process.env.GOOGLE_CREDENTIALS_PATH, 'utf8'));
const SCOPES = ['https://www.googleapis.com/auth/calendar'];

function getCalendarClient(subject = null) {
  const auth = new google.auth.JWT({
    email: credentials.client_email,
    key: credentials.private_key,
    scopes: SCOPES,
    subject: subject || undefined, // omitido no caminho "agenda compartilhada"
  });
  return google.calendar({ version: 'v3', auth });
}
module.exports = { getCalendarClient };
```

### 4.5 API — `server.js` (endpoints e lógica)

Endpoints principais:

- `GET /profissionais` — lista profissionais (passou a retornar `foto_url` na Sessão 3).
- `GET /servicos` — lista serviços com duração e valor.
- `GET /horarios-disponiveis?profissionalId=&data=&duracaoMin=` — gera os horários livres.
- `POST /agendamento` — valida, re-checa colisão, insere no Calendar, persiste no banco e dispara confirmação.
- `POST /webhook-whatsapp` — recebe respostas `1/2/3` do cliente.

**Lógica de geração de horários (versão original — continha o bug corrigido na Sessão 3):**

```js
const EXPEDIENTE = { inicioHora: 9, fimHora: 18 };
// ... consulta freeBusy => "ocupados"
const slots = [];
const cursor = /* início do expediente */;
const limite = /* fim do expediente */;
while (cursor < limite) {
  const slotInicio = new Date(cursor);
  const slotFim = new Date(cursor.getTime() + duracao * 60000);
  if (slotFim <= limite) {
    const colide = ocupados.some(b =>
      slotInicio < new Date(b.end) && slotFim > new Date(b.start)); // overlap
    const noPassado = slotInicio <= new Date();
    if (!colide && !noPassado) slots.push(/* ... */);
  }
  cursor.setMinutes(cursor.getMinutes() + duracao); // ⚠️ passo = duração (BUG, ver §6.8)
}
```

**Pontos de arquitetura deliberados:**
- **Re-checagem `freeBusy` antes do `insert`** evita a condição de corrida (dois clientes pegando o mesmo horário) → retorna `409` se ocupou.
- A **falha do WhatsApp não derruba o agendamento** (degradação graciosa).
- **Validação no servidor**, não só no front (nome+sobrenome, telefone E.164).

### 4.6 Cron de lembretes — `cron-lembretes.js`

Estratégia de **idempotência por janela**: rodando periodicamente, o job busca agendamentos cujo início cai numa faixa em torno do alvo de antecedência e marca `lembrete_enviado = 1` apenas em caso de sucesso (para permitir nova tentativa no próximo ciclo se o gateway falhar).

```js
const ANTECEDENCIA_MIN = 60;   // alvo: 1h antes
const TOLERANCIA_MIN = 15;
// janela = [agora + (60-15)min, agora + (60+15)min]
// SELECT ... WHERE status='confirmado' AND lembrete_enviado=0 AND inicio BETWEEN janelaInicio AND janelaFim
// para cada pendente: enviarWhatsapp(...); se ok => UPDATE lembrete_enviado=1
```

> Recomendação registrada: rodar **API e cron como dois processos separados**, para que um reinício da API não interrompa os lembretes. (Concretizado depois com dois serviços no Docker Compose — `api` e `cron`.)

### 4.7 Containerização (Docker)

`Dockerfile` final (após a correção do §4.8):

```dockerfile
# Node 22 LTS (debian slim) — better-sqlite3 tem binário pré-compilado p/ glibc.
# NÃO usar "alpine": musl forçaria compilação nativa.
FROM node:22-slim
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY . .
EXPOSE 3000
CMD ["node", "server.js"]
```

### 4.8 Troubleshooting da Sessão 1

#### Problema 1 — Segredos reais vazaram nos arquivos enviados
**Sintoma:** o `credentials.json` continha um `client_secret` real e o `_env.example` continha ID/token reais da Z-API.
**Solução:** tratar ambos como **comprometidos** e regenerar — redefinir o secret no Google Cloud e regenerar o token no painel da Z-API. **Regra fixada:** segredos só vão no `.env` (não versionado); o `_env.example` leva apenas placeholders (`SEU_TOKEN_AQUI`).

#### Problema 2 — `.env` nunca foi criado
**Sintoma:** crash no start, pois `GOOGLE_CREDENTIALS_PATH` ficava `undefined` e o `fs.readFileSync` em `google.js` quebrava.
**Solução:** criar o `.env` a partir do modelo:
```bash
cp _env.example .env
```

#### Problema 3 — Dependência do banco trocada
**Sintoma:** o `package.json` foi alterado para `"sqlite3": "^6.0.1"` (versão inexistente), mas `db.js` faz `require('better-sqlite3')` (API síncrona, incompatível com a do `sqlite3`). Resultado: `Cannot find module 'better-sqlite3'`.
**Solução:** restaurar `better-sqlite3` no `package.json` e limpar a instalação inconsistente:
```bash
rm -rf node_modules package-lock.json
npm install
```

#### Problema 4 — `credentials.json` do tipo errado
**Sintoma:** o arquivo baixado era um **OAuth Client ID (app web)** — tem `client_id`/`client_secret`, mas o código espera **Service Account** (`client_email`/`private_key`). Autenticação falharia mesmo após corrigir os itens 1–3.
**Solução:** gerar a chave JSON de uma **Service Account** (passo a passo em §4.2) e substituir o `credentials.json`.

#### Problema 5 — `better-sqlite3` × Node 24 (sem binário pré-compilado)
**Sintoma:** mesmo instalando, o `better-sqlite3` v11 não tem prebuilt para Node 24 (ABI `node-v137`); sem ferramentas de build (Python/compilador), a compilação nativa falha.
**Causa-raiz:** versão do `better-sqlite3` anterior ao suporte a Node 24 **+** ambiente Node 24 muito recente.
**Solução adotada (dupla):**
1. **Fixar o runtime no Docker em `node:22-slim`** (LTS com glibc e prebuilt disponível) — evita compilar.
2. Atualizar o `better-sqlite3` (hoje em `^12.2.0`, que já tem suporte a Node 24).
> Lição: a variante `alpine` (musl) também forçaria compilação — por isso o `slim` (Debian/glibc).

---

## 5. SESSÃO 2 — WhatsApp: Evolution API, Anti-ban e Webhook

> **Objetivo da sessão:** fazer o WhatsApp **realmente entregar** as mensagens (na Sessão 1 enviava mas não chegava) e tornar os disparos seguros contra banimento.

### 5.1 Stack Evolution no Docker Compose

A Evolution roda junto da app via `docker-compose.full.yml` (app + cron + `evolution-api` + `evolution-postgres`). A app conversa com a Evolution pela **rede interna do compose**, usando o nome do serviço:

```env
WHATSAPP_API_URL=http://evolution-api:8080
```

Painel/manager acessível em `http://192.168.1.100:8080/manager`; app em `http://192.168.1.100:8090`.

### 5.2 Subir o stack (comando padrão no Zima)

```bash
sudo env DOCKER_CONFIG=/DATA/.docker docker compose -f docker-compose.full.yml up -d --build
```

Pareamento: criar a instância e ler o **QR Code** pelo manager, com o WhatsApp do celular (Aparelhos conectados → Conectar aparelho).

### 5.3 Troubleshooting central — "envia mas não chega"

#### Problema — Mensagem aceita pela API, mas nunca entregue
**Sintoma:** o `POST` de envio retornava sucesso, a instância aparecia conectada, mas a mensagem não chegava ao destinatário.
**Causa-raiz:** a **versão do WhatsApp Web embarcada no Baileys (motor da Evolution) estava expirada**. O WhatsApp rejeita silenciosamente sessões de versões antigas.
**Solução (combinação que funcionou em produção):**
1. **Fixar a versão do WhatsApp Web** via variável de ambiente da Evolution:
   ```env
   CONFIG_SESSION_PHONE_VERSION=2.3000.1040656236
   ```
   > A versão correta é obtida em `wppconnect.io/pt-BR/whatsapp-versions` (usar a versão **sem** o sufixo `-alpha`). **Expira periodicamente** — ver §9.
2. **Fixar a imagem da Evolution** numa versão estável: **`evoapicloud/evolution-api:v2.3.7`**.
3. **Recriar a instância** (deletar e criar de novo) para a nova versão valer:
   ```bash
   # apagar
   curl -X DELETE http://localhost:8080/instance/delete/manicure -H "apikey: SUA_API_KEY"
   # criar (integração Baileys)
   curl -X POST http://localhost:8080/instance/create \
     -H "apikey: SUA_API_KEY" -H "Content-Type: application/json" \
     -d '{"instanceName":"manicure","integration":"WHATSAPP-BAILEYS"}'
   ```
4. **Atualizar o app do WhatsApp no celular** e parear de novo (QR).

> ⚠️ **Divergência a corrigir no repositório:** o `docker-compose.full.yml` versionado ainda referencia `atendai/evolutionapi:v2.1.1`. A versão **que funciona em produção** é `evoapicloud/evolution-api:v2.3.7` **com** `CONFIG_SESSION_PHONE_VERSION`. Atualizar o arquivo do repo para refletir o que está no ar.

### 5.4 Comportamento humano (anti-ban) — `whatsapp.js`

Para evitar banimento por padrão "robótico", o envio simula comportamento humano:

- **Delay aleatório** antes de enviar (3–12 s);
- **Indicador "digitando…"** via `sendPresence` antes da mensagem;
- **Envio em lote espaçado** (intervalos de 30–120 s entre mensagens) através de `enviarWhatsappLote`;
- **Variação de texto** (nunca a mesma mensagem literal em série);
- **Janela de horário** (`dentroDoHorario`, 8h–21h) para não enviar de madrugada.

Os tempos são configuráveis via `.env` (chaves `ENVIO_*`).

### 5.5 Variações de mensagem — `mensagens.js`

`montarMensagem(tipo, dados)` sorteia entre variações de texto por tipo: `confirmacao`, `vespera`, `lembrete1h`, `reagendar`, `confirmado`, `cancelado`. Isso alimenta tanto a confirmação imediata quanto o cron, reduzindo repetição.

### 5.6 Webhook de respostas (`1/2/3`) — reescrito

O endpoint `POST /webhook-whatsapp` foi reescrito para ser **tolerante a formato** (normaliza tanto `messages.upsert` quanto `MESSAGES_UPSERT`), com **logs em cada etapa**. Configuração do webhook na Evolution:

```bash
curl -X POST http://localhost:8080/webhook/set/manicure \
  -H "apikey: SUA_API_KEY" -H "Content-Type: application/json" \
  -d '{"webhook":{"url":"http://agendamento-api:3000/webhook-whatsapp","events":["MESSAGES_UPSERT"]}}'
```

Comportamento por resposta:
- `1` → confirma presença (mensagem de confirmação);
- `2` → **reagendar**;
- `3` → **cancelar** → remove o evento do Calendar (`events.delete`) e marca `status='cancelado'`. A função `liberarAgenda()` só responde "liberado" se de fato cancelou; trata `404/410` (evento já inexistente).

> Mapeamento correto e final: **2 = Reagendar, 3 = Cancelar** (corrigido na Sessão 3 — ver §6.1).

### 5.7 Versionamento (Git)

Código publicado em `github.com/Parllon/Agenda_de_Servicos` (branch `main`). `.gitignore` protege segredos e dados (ver §7.4). Commits da sessão cobrindo a entrega do WhatsApp e o início da separação do frontend.

---

## 6. SESSÃO 3 — Refino, Features e GO-LIVE

> **Objetivo da sessão:** integrar o comportamento humano no fluxo real, polir o frontend, adicionar features (foto, validação, abas), **publicar na internet** e corrigir bugs encontrados em uso real.

### 6.1 Integração do comportamento humano no `server.js` e no cron

1. A **confirmação de agendamento** no `server.js` passou a usar `montarMensagem` + envio **fire-and-forget** (sem `await`), para a tela não travar durante o delay anti-ban.
2. O **webhook** (`1/2/3`) passou a usar variações de texto.
3. O **cron** passou a usar `enviarWhatsappLote` + `montarMensagem`.
4. **Correções de alinhamento:** a mensagem de véspera dizia "2 Cancelar", mas o sistema usa **2=Reagendar / 3=Cancelar** → corrigido. Variações de véspera tinham placeholders `{profissional}`/`{data}` que o cron não preenchia (vazariam literais) → simplificadas.
5. `testar-vespera.js` atualizado para usar `enviarWhatsappLote` + `montarMensagem`.

### 6.2 Expediente e Folgas movidos para o `.env`

Antes fixos no código; agora configuráveis sem rebuild:

```env
EXPEDIENTE_INICIO=9
EXPEDIENTE_FIM=19
FOLGAS=0
```

Regras de parsing de `FOLGAS` (dias da semana, 0=domingo):
- `"0"` → `[0]`; `"0,6"` → `[0,6]`; **vazio** → `[]` (abre todos os dias — útil em teste); **ausente** → `[0]` (padrão seguro).

**Ganho:** mudar horário/folga = editar `.env` + `up -d` (**sem `--build`**).

### 6.3 Separação do frontend em 3 arquivos

O HTML monolítico foi dividido em `public/index.html` (estrutura + config do Tailwind inline + links), `public/styles.css` (estilos custom) e `public/app.js` (lógica). Servidos pelo Express.

> ⚠️ Descoberto que `public/app.js` e `public/styles.css` estavam **untracked** (nunca commitados desde a separação) — incluídos no commit. (Aprendizado: `git add -A`.)

### 6.4 Feature — alerta de validação (shake)

Ao **sair** de um campo (nome/telefone) incompleto, o campo **sacode** (animação shake) + borda vermelha + mensagem destacada; some ao corrigir; **não dispara em campo vazio**. Gatilho = `blur`; o botão de avançar permanece desabilitado até a validação passar. Implementado em `app.js` (`marcarErro`/`limparErro`) e `styles.css` (`.campo-erro`/`.msg-erro`/`.shake`).

### 6.5 Feature — foto da profissional

Foto redonda + nome centralizado abaixo; sem foto → inicial no molde redondo; cards lado a lado e centralizados (`flex-wrap` + `justify-center`); **fallback automático** se a foto quebrar (`img.onerror`).

Arquivos tocados:
- `db.js` — migração adicionando a coluna `foto_url` em `profissionais`;
- `seed.js` — campo `foto_url`;
- `server.js` — `GET /profissionais` passa a retornar `foto_url`;
- `public/app.js` — `carregarProfissionais` reescrito via DOM;
- `public/index.html` — container dos cards.

As fotos ficam em `public/fotos/` (caminho tipo `/fotos/foto.jpg`) ou URL externa. Deploy desta feature = rebuild + re-seed:
```bash
sudo env DOCKER_CONFIG=/DATA/.docker docker compose -f docker-compose.full.yml run --rm api node seed.js
```

#### Problema — foto não aparecia
**Sintoma:** card mostrava a inicial (fallback) em vez da imagem.
**Causa-raiz:** **extensão errada** — o `seed.js` apontava `.jpg`, mas o arquivo era `.jpeg`. O Linux é sensível a maiúsculas/extensão.
**Solução:** corrigir a extensão (alinhar arquivo ↔ seed) e re-seed.

> **Decisão:** fotos **não** vão para o Git (dados de cliente) → `public/fotos/` adicionado ao `.gitignore`. **Aviso:** as fotos só existem no Zima — precisam de **backup separado** (ver §9).

### 6.6 GO-LIVE — Cloudflare Tunnel no ZimaOS (passo a passo)

**Domínio escolhido:** `agendamento.deadzone.com.br` (o domínio `deadzone.com.br` já estava **Active** na conta Cloudflare). Descartados `parllondev.net`/`agendamentos.app.br` para não mexer em DNS de outros serviços.

> **Particularidade do ZimaOS:** `/usr/local/bin` e `/root` são **read-only**. Por isso o binário foi instalado em `/DATA/bin` e o `HOME` do cloudflared foi forçado para `/DATA/cloudflared`.

1. **Instalar o `cloudflared` em `/DATA/bin`:**
   ```bash
   sudo mkdir -p /DATA/bin
   cd /DATA/bin
   sudo curl -L --output cloudflared \
     https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64
   sudo chmod +x cloudflared
   ```
   (Versão instalada: 2026.6.0.)

2. **Autenticar** (abre URL para login na Cloudflare):
   ```bash
   sudo HOME=/DATA/cloudflared /DATA/bin/cloudflared tunnel login
   ```
   → cert salvo em `/DATA/cloudflared/.cloudflared/cert.pem`.

3. **Criar o túnel:**
   ```bash
   sudo HOME=/DATA/cloudflared /DATA/bin/cloudflared tunnel create agendamento
   ```
   → nome `agendamento`, ID `d6f1e2aa-6d7f-49ba-b7c1-6486f80e2b4b`.

4. **Criar o registro DNS (CNAME automático):**
   ```bash
   sudo HOME=/DATA/cloudflared /DATA/bin/cloudflared tunnel route dns agendamento agendamento.deadzone.com.br
   ```

5. **Configurar o `config.yml`** em `/DATA/cloudflared/.cloudflared/config.yml`:
   ```yaml
   tunnel: d6f1e2aa-6d7f-49ba-b7c1-6486f80e2b4b
   credentials-file: /DATA/cloudflared/.cloudflared/d6f1e2aa-6d7f-49ba-b7c1-6486f80e2b4b.json
   ingress:
     - hostname: agendamento.deadzone.com.br
       service: http://192.168.1.100:8090
     - service: http_status:404
   ```

6. **Instalar como serviço** (sobe sozinho no boot):
   ```bash
   sudo HOME=/DATA/cloudflared /DATA/bin/cloudflared \
     --config /DATA/cloudflared/.cloudflared/config.yml service install
   ```
   → `active (running)` + `enabled`. **Site no ar**, confirmado via 4G.

> 📌 **Nota operacional:** ao instalar como serviço, o cloudflared passa a usar **`/etc/cloudflared/config.yml`** (cópia feita no install). Se precisar editar a config do serviço, edite **lá**.

7. **Ajustes de aplicação para produção** (no `.env` — em conclusão na próxima etapa):
   ```env
   LANDING_URL=https://agendamento.deadzone.com.br
   CORS_ORIGIN=https://agendamento.deadzone.com.br
   ```
   > Sobre CORS: vazio = libera tudo (aceitável só localmente). Em produção, preencher com o domínio.

> O `server.js` usa `helmet` + `express-rate-limit` + `trust proxy 1` (necessário atrás do Cloudflare) para segurança em produção.

### 6.7 Troubleshooting do GO-LIVE

#### Problema — `cloudflared login`/`create` falhavam ao escrever config
**Sintoma:** o cloudflared tentava criar arquivos em `/root/.cloudflared` (read-only no ZimaOS) e abortava.
**Solução:** **prefixar todos os comandos** com `sudo HOME=/DATA/cloudflared`, redirecionando o diretório de trabalho do cloudflared para uma área gravável.

### 6.8 BUG — geração de horários (cursor avançando pela duração)

#### Problema — serviço longo mostrava pouquíssimos (ou nenhum) horário
**Sintomas reais relatados:**
1. Serviço de **210 min (3h30)** exibia apenas **2 horários** (9h e 12h30) **mesmo com a agenda totalmente livre**.
2. Com a agenda parcialmente ocupada (eventos 9–10h e 12–13h) e a **tarde inteira livre** (salão até 19h), exibia **"Nenhum horário livre"**.

**Causa-raiz:** o cursor de geração de slots avançava **pela duração do serviço**, não por um passo fixo:
```js
cursor.setMinutes(cursor.getMinutes() + duracao); // ⚠️ pula de 3h30 em 3h30
```
Logo, para 3h30 a partir das 9h, só testava 9:00 → 12:30 → 16:00 (este último estoura as 19h). Nunca testava 13:00, 13:30 etc. Com os eventos das 9h e 12h, os dois únicos candidatos colidiam → zero horários.

**Solução:** introduzir um **passo de grade fixo e configurável** (`SLOT_STEP_MIN`, padrão 30 min) e avançar o cursor por ele:
```js
const SLOT_STEP_MIN = parseInt(process.env.SLOT_STEP_MIN || '30', 10);
// ...
cursor.setMinutes(cursor.getMinutes() + SLOT_STEP_MIN); // passo fixo (independe da duração)
```

**Validação (simulação do cenário real — 210 min, eventos 9–10h e 12–13h, expediente 9–19h, passo 30):**
```
Horários livres: 13:00, 13:30, 14:00, 14:30, 15:00, 15:30
```
O último (15:30) termina exatamente às 19:00 — não estoura o fechamento. ✅

**Configuração:** `SLOT_STEP_MIN=30` (padrão) gera inícios de meia em meia hora; `SLOT_STEP_MIN=60` força hora cheia. Como o `server.js` mudou, o deploy desta correção exige **`--build`**.

### 6.9 Navegação por abas (indicador de passos clicável)

- Clicar num passo **anterior** no indicador volta para ele (`cursor-pointer`); **avançar** continua somente pelo botão (que valida).
- Trocar profissional/serviço **limpa `state.horario`** (evita inconsistência: horário válido para um serviço pode não ser para outro).
- Ajuste visual: indicador de passos com fonte menor e `gap` no mobile (`sm:tracking-widest`) — corrige os títulos colados.

#### Problema — "a navegação não funciona"
**Causa-raiz:** **cache do navegador** servindo o JS antigo.
**Solução:** `Ctrl+Shift+R` (hard refresh).
> ⚠️ Em produção há **dois caches**: o do navegador **e** o da Cloudflare. Para limpar o da Cloudflare: painel → **Caching → Purge Everything**.

### 6.10 Personalização do cliente piloto (Bya Marcondes)

A profissional de teste passou de "Patrícia Lima" para **Bya Marcondes**. O usuário fez edições próprias a partir de uma versão antiga; o conteúdo foi **mesclado** com as features 6.8/6.9:
- `app.js` — validação de telefone com **11 dígitos** (`if (dig.length !== 11)`);
- `index.html` — header "Nail Designer / Bya Marcondes", `title`, rodapé "Bya Marcondes · Rio de Janeiro";
- `seed.js` — sincronizado (Bya `id1`, foto `/fotos/foto_bya.jpeg`) + 9 serviços.

> ⚠️ **Pendência conhecida:** a profissional `Joana` (`id2`) ainda está no `seed.js` com `calendar_id` placeholder (`outra@gmail.com`) — **daria erro** se selecionada. Decidir: remover do seed ou apontar para uma agenda real (ver §11).

---

## 7. Configuração de Referência

### 7.1 `.env` completo (com explicação)

```env
# --- App ---
PORT=3000
TIMEZONE=America/Sao_Paulo
TIMEZONE_OFFSET=-03:00

# --- Google ---
GOOGLE_CREDENTIALS_PATH=./credentials.json

# --- WhatsApp (Evolution) ---
WHATSAPP_PROVIDER=evolution
WHATSAPP_API_URL=http://evolution-api:8080     # rede interna do compose
WHATSAPP_API_TOKEN=...                          # = EVOLUTION_API_KEY
WHATSAPP_INSTANCE=manicure
EVOLUTION_API_KEY=...                           # chave de autenticação da Evolution

# --- Lembretes ---
JANELA_DIAS=30                                  # quão longe no futuro a agenda abre
LEMBRETE_VESPERA_HORA=21                        # hora do lembrete da véspera
ANTECEDENCIA_MIN=60                             # alvo do lembrete relativo (min antes)

# --- Comportamento humano (anti-ban) ---
ENVIO_DELAY_MIN=3                               # delay antes de enviar (s)
ENVIO_DELAY_MAX=12
ENVIO_LOTE_MIN=30                               # intervalo entre msgs do lote (s)
ENVIO_LOTE_MAX=120

# --- Expediente / grade (Sessão 3) ---
EXPEDIENTE_INICIO=9
EXPEDIENTE_FIM=19
FOLGAS=0                                         # 0=domingo; "0,6"; vazio=abre tudo
SLOT_STEP_MIN=30                                 # passo da grade de horários (min)

# --- Produção (GO-LIVE) ---
LANDING_URL=https://agendamento.deadzone.com.br
CORS_ORIGIN=https://agendamento.deadzone.com.br

# --- Evolution: versão do WhatsApp Web (EXPIRA — ver §9) ---
CONFIG_SESSION_PHONE_VERSION=2.3000.1040656236
```

### 7.2 `Dockerfile`
Ver §4.7.

### 7.3 `docker-compose.full.yml`

Stack: `api` (porta `8090:3000`), `cron`, `evolution-api` (porta `8080`), `evolution-postgres`. Volumes: `agendamento-data`, `evolution-instances`, `evolution-pg`. O `credentials.json` é montado read-only em `api` e `cron`.

> ⚠️ Atualizar a imagem da Evolution no arquivo para **`evoapicloud/evolution-api:v2.3.7`** e garantir `CONFIG_SESSION_PHONE_VERSION` no ambiente, para refletir a configuração que funciona em produção (ver §5.3).

### 7.4 `.gitignore`

Protege: `.env`, `.env.production`, `credentials.json`, `*.db`, `node_modules`, `public/fotos/`.

### 7.5 `package.json` (dependências)

`axios`, `better-sqlite3 ^12.2.0`, `cors`, `dotenv`, `express`, `express-rate-limit ^7.4.0`, `helmet ^8.0.0`, `googleapis ^144.0.0`, `node-cron`. Scripts: `start`, `cron`, `seed`.

---

## 8. Operação — Cheat Sheet de Comandos

### 8.1 Deploy / rebuild (quando muda **código**)
```bash
cd ~/Agendamento
sudo env DOCKER_CONFIG=/DATA/.docker docker compose -f docker-compose.full.yml up -d --build
```

### 8.2 Subir sem rebuild (quando muda só o **.env**)
```bash
sudo env DOCKER_CONFIG=/DATA/.docker docker compose -f docker-compose.full.yml up -d
```

### 8.3 Re-seed (quando muda **seed.js** / profissionais / serviços / fotos)
```bash
sudo env DOCKER_CONFIG=/DATA/.docker docker compose -f docker-compose.full.yml run --rm api node seed.js
```

### 8.4 Cloudflare Tunnel (serviço)
```bash
sudo systemctl status cloudflared        # ver estado
sudo systemctl restart cloudflared       # reiniciar
# editar config do serviço: /etc/cloudflared/config.yml  (NÃO a de /DATA, depois do install)
```

### 8.5 Evolution — recriar instância e webhook
```bash
# recriar instância (após mudar a versão do WhatsApp Web)
curl -X DELETE http://localhost:8080/instance/delete/manicure -H "apikey: SUA_API_KEY"
curl -X POST   http://localhost:8080/instance/create \
  -H "apikey: SUA_API_KEY" -H "Content-Type: application/json" \
  -d '{"instanceName":"manicure","integration":"WHATSAPP-BAILEYS"}'

# reconfigurar webhook
curl -X POST http://localhost:8080/webhook/set/manicure \
  -H "apikey: SUA_API_KEY" -H "Content-Type: application/json" \
  -d '{"webhook":{"url":"http://agendamento-api:3000/webhook-whatsapp","events":["MESSAGES_UPSERT"]}}'

# checar instâncias
curl -s http://localhost:8080/instance/fetchInstances -H "apikey: SUA_API_KEY"
```

### 8.6 Git
```bash
git status                 # conferir que NÃO há segredos/fotos a subir
git add -A
git commit -m "mensagem"
git push
```

### 8.7 Limpeza de cache (debug de frontend)
- Navegador: `Ctrl+Shift+R`.
- Cloudflare: painel → **Caching → Purge Everything**.

---

## 9. Manutenção Recorrente

| Item | Frequência | Ação |
|---|---|---|
| **`CONFIG_SESSION_PHONE_VERSION`** | Expira ~**02/08/2026** | Pegar a versão atual em `wppconnect.io/pt-BR/whatsapp-versions` (sem `-alpha`), atualizar no `.env`, **recriar a instância** e parear de novo (§5.3). |
| **Backup das fotos** | Sempre que adicionar/trocar | As fotos em `public/fotos/` **não estão no Git**. Copiá-las para um local seguro. |
| **Backup do banco** | Periódico | O `*.db` (volume `agendamento-data`) guarda o estado de lembretes. Fazer cópia do volume. |
| **App do WhatsApp no celular** | Quando reconectar | Manter atualizado para evitar conflito de versão de sessão. |

---

## 10. Decisões de Negócio

### 10.1 Precificação e planos (pesquisa de mercado)

Mercado BR observado: R$19,90–110/mês; concorrente Trinks R$89–249. Faixa para "WhatsApp automático sem cobrar por mensagem": R$59,90–119,90. **Estrutura recomendada (3 planos):**

| Plano | Escopo | Faixa |
|---|---|---|
| **Essencial** | Só agenda | R$39–49 |
| **Profissional** *(carro-chefe)* | Agenda + WhatsApp | R$69–89 |
| **Premium** | Landing + agenda + WhatsApp | R$119–149 |

**Táticas:** lançar na ponta de baixo como "preço de lançamento"; modelo de **mensalidade recorrente** (+ setup pequeno opcional só no Premium); o **diferencial é atendimento próximo, não preço** (custo marginal ~zero permite isso).

### 10.2 Estratégia de vendas — SPIN em 2 camadas (`PLAYBOOK-VENDAS-SPIN.md`)

- **1ª mensagem** tem um único objetivo: ganhar resposta. **SPIN não roda em mensagem fria.**
- **Disparo frio em massa queima o número** → usar um **número de vendas separado** do que atende clientes; priorizar abordagem **morna** (indicação/contato local); nunca copy-paste em série.
- **Vídeo + landing** entram **depois** da fase de Implicação do SPIN.
- O playbook inclui scripts, tratamento de objeções e follow-up.

### 10.3 Cliente-zero

A **Bya** é cliente-zero (não cobrar de forma tradicional). Os primeiros 2–3 clientes servem como **pesquisa + depoimento + indicação**.

---

## 11. Pendências e Roadmap

**Pendências imediatas:**
1. **Concluir os ajustes de produção no `.env`** do Zima (LANDING_URL, CORS_ORIGIN, FOLGAS, EXPEDIENTE, SLOT_STEP_MIN) e confirmar o **expediente real** da Bya; rebuild + re-seed; testar serviço de 3h30.
2. **Commitar** as últimas mudanças (server.js com `SLOT_STEP_MIN`; app.js/index.html com navegação/abas/telefone/Bya; seed.js).
3. **Joana no seed** — remover ou corrigir `calendar_id` placeholder.
4. **Confirmar a cidade** da Bya no rodapé do `index.html`.
5. **Atualizar o `docker-compose.full.yml`** no repo para a imagem/versão da Evolution que está em produção (§5.3).

**Sugestões (não pedidas):**
- Roteiro de vídeo de vendas;
- Painel administrativo (fase 2; gatilho: 3º cliente);
- Seleção **múltipla** de serviços (fácil no front, mas levanta regras de negócio);
- Aba de planos na planilha de custos;
- Retry/backoff nas chamadas ao Google;
- Alerta de falha de envio do WhatsApp.

---

## 12. Apêndice — Tabela consolidada Problema × Solução

| # | Sessão | Problema | Causa-raiz | Solução |
|---|---|---|---|---|
| 1 | 1 | Segredos reais vazaram nos arquivos | Token/secret colocados no `_env.example` e `credentials.json` versionável | Regenerar secret (Google) e token (Z-API); segredos só no `.env`; placeholders no `.example` |
| 2 | 1 | App não sobe (crash no start) | `.env` não criado → `GOOGLE_CREDENTIALS_PATH` indefinido | `cp _env.example .env` |
| 3 | 1 | `Cannot find module 'better-sqlite3'` | `package.json` trocado para `sqlite3` (API incompatível) | Restaurar `better-sqlite3`; `rm -rf node_modules package-lock.json && npm install` |
| 4 | 1 | Autenticação Google falharia | `credentials.json` era OAuth Client, não Service Account | Gerar chave JSON de Service Account e compartilhar a agenda com o e-mail dela |
| 5 | 1 | `better-sqlite3` não compila no Node 24 | Versão sem prebuilt p/ ABI node-v137 + Node 24 muito novo | Fixar `node:22-slim` no Docker (glibc, com prebuilt) + atualizar para `better-sqlite3 ^12` |
| 6 | 2 | WhatsApp envia mas não entrega | Versão do WhatsApp Web (Baileys) expirada | `CONFIG_SESSION_PHONE_VERSION` atual + imagem `evoapicloud/evolution-api:v2.3.7` + recriar instância + atualizar app do celular |
| 7 | 3 | Foto da profissional não aparece | Extensão errada no seed (`.jpg` vs `.jpeg`); Linux é case/extension-sensitive | Alinhar arquivo ↔ seed + re-seed |
| 8 | 3 | `app.js`/`styles.css` não chegavam ao GitHub | Arquivos ficaram untracked desde a separação | `git add -A` e commitar |
| 9 | 3 | `cloudflared login/create` aborta | ZimaOS com `/root` e `/usr/local/bin` read-only | Instalar em `/DATA/bin` e prefixar tudo com `sudo HOME=/DATA/cloudflared` |
| 10 | 3 | Serviço longo mostra 2 ou 0 horários | Cursor avançava pela **duração**, não por passo fixo | `SLOT_STEP_MIN` (padrão 30) e cursor avança pelo passo |
| 11 | 3 | "Navegação não funciona" | Cache do navegador (e, em produção, da Cloudflare) | `Ctrl+Shift+R`; em produção, Purge Everything no painel |

---

*Documento gerado como guia oficial do projeto. Para o código-fonte completo de cada arquivo, consultar o repositório `github.com/Parllon/Agenda_de_Servicos`.*