# SlotMe — Documentação Oficial

Sistema de agendamento multi-cliente (manicure, barbearia, etc.). Um único código
("motor") atende vários salões; cada cliente é uma instância isolada, com seus
próprios dados, banco, tema e WhatsApp.

> **Como ler:** se você só quer **colocar um cliente novo no ar**, vá direto para
> a seção **"Manual: adicionar um cliente novo"**. O resto é referência.

---

## 1. Visão geral da arquitetura

A ideia central é **separar o código da configuração de cada cliente**:

- **O motor** (`/app`) é o código. É construído **uma vez** como a imagem Docker
  `motor-agendamento:v1`. Corrigiu um bug? Reconstrói a imagem uma vez e todos os
  clientes recebem a correção.
- **Cada cliente** (`/clientes/<nome>`) é só **configuração**: um `.env` (infra +
  tema), um `dados.json` (nome, profissionais, serviços, preços), as fotos e o
  banco. Nenhum código é duplicado.
- **O WhatsApp** (`/Evolution_Global`) é **uma só** Evolution API para todos. Cada
  cliente tem a sua *instância* (uma conexão de número) dentro dela.

Benefício: cliente novo = "mesmo motor + tema + dados", em minutos. E o isolamento
garante que os dados de um cliente nunca encostam nos de outro.

---

## 2. Estrutura de pastas

```
~/Agendamento/
├── Evolution_Global/      # WhatsApp central (Evolution API + Postgres)
│   ├── docker-compose.yml
│   └── .env               # EVOLUTION_API_KEY (chave mestre) + CONFIG_SESSION_PHONE_VERSION
│
├── app/                   # O MOTOR — código único (buildado como motor-agendamento:v1)
│   ├── public/            # frontend (index.html, app.js, styles.css)
│   ├── server.js, db.js, google.js, whatsapp.js, mensagens.js, seed.js,
│   │   temas.js, cron-lembretes.js, ...
│   ├── Dockerfile
│   └── credentials.json   # service account do Google (compartilhada por todos)
│
├── clientes/              # AS INSTÂNCIAS (config, zero código)
│   ├── _template/         # MOLDE — copiado para cada cliente novo
│   │   ├── .env
│   │   ├── dados.json
│   │   ├── docker-compose.yml
│   │   └── fotos/
│   ├── bya/               # cliente 1 (porta 8090, tema manicure)
│   │   ├── .env
│   │   ├── dados.json
│   │   ├── docker-compose.yml
│   │   ├── banco_dados/   # SQLite isolado (NÃO versionar)
│   │   └── fotos/         # fotos dos profissionais (NÃO versionar)
│   └── navalha_de_ouro/   # cliente 2 (porta 8091, tema barbearia)
│
├── novo-cliente.sh        # cria a estrutura de um cliente novo
├── atualizar-cliente.sh   # sobe / reaplica um cliente (up + seed + restart)
├── .gitignore
└── .gitattributes
```

---

## 3. Como as peças se conectam

- **Imagem única:** `app/Dockerfile` → `motor-agendamento:v1`. Todo cliente usa
  essa imagem (o `docker-compose.yml` do cliente **não faz build**).
- **Tema:** a variável `TEMA` (`manicure` | `barbearia`) no `.env` escolhe o visual.
  As cores são variáveis CSS que o `server.js` injeta no topo da página conforme o
  tema — por isso nenhuma classe muda, só os valores. Presets ficam em `app/temas.js`.
- **Ficha do cliente (`dados.json`):** é a fonte única dos dados do cliente. O
  `seed.js` lê dela e popula o banco (profissionais e serviços); o `server.js` lê a
  identidade (nome, subtítulo, cidade) dela para o frontend.
- **Rede `agenda-net`:** rede Docker externa que liga os containers dos clientes à
  Evolution global. É por ela que o app de um cliente alcança a Evolution pelo nome
  `evolution-api`, e que a Evolution alcança o app pelo nome `<cliente>-app`.
- **Cloudflare Tunnel:** cada cliente tem uma porta externa única (8090, 8091, ...)
  e um subdomínio apontando para ela.

### Regra de ouro: prefixo dos comandos Docker

No ZimaOS, o `/root` é somente leitura. Por isso **todo** comando Docker leva o
prefixo abaixo (aponta a config do Docker para uma pasta gravável):

```bash
sudo env DOCKER_CONFIG=/DATA/.docker docker ...
```

Neste manual, onde aparecer `docker ...`, leia com esse prefixo.

---

## 4. Manual: adicionar um cliente novo (do zero ao ar)

Cenário: fechei com a "Studio Carol", uma manicure. Vou colocá-la no ar como
`carol`, na porta `8092`, no subdomínio `carol.deadzone.com.br`.

### Pré-requisitos (já devem existir — confira uma vez)
- Imagem `motor-agendamento:v1` construída.
- Rede `agenda-net` criada (`docker network create agenda-net`).
- Evolution global no ar (`Evolution_Global` rodando).

### Passo 1 — Criar a estrutura (1 comando)
```bash
cd ~/Agendamento
sudo ./novo-cliente.sh carol 8092 manicure
```
Isso copia o molde, configura o `.env` (CLIENTE, PORTA_EXTERNA, TEMA,
WHATSAPP_INSTANCE) e cria as pastas `banco_dados/` e `fotos/`.

> **A porta tem que ser única.** Bya=8090, Navalha=8091 → a próxima é 8092, 8093...
> Porta repetida = o Docker recusa subir.

### Passo 2 — Preencher a ficha do cliente
Edite `clientes/carol/dados.json` com os dados reais:
- `negocio`: nome, subtítulo, cidade, telefone.
- `profissionais`: para cada um, `nome`, `calendar_id` (ver Passo 3), `foto_url`
  (ex.: `/fotos/carol.jpg`) e a lista de `servicos` (nome, duração em minutos, valor).

Coloque as fotos em `clientes/carol/fotos/` (o nome do arquivo precisa bater com o
`foto_url`). Sem foto, o sistema mostra a inicial do nome.

### Passo 3 — Google Calendar (para o agendamento gravar de verdade)
Para **cada** profissional:
1. No Google Calendar do profissional, compartilhe a agenda com a service account:
   **`calendar-bot@agenda-de-servicos-498211.iam.gserviceaccount.com`**, com a
   permissão **"Fazer alterações nos eventos"**.
2. Pegue o **ID da agenda** (Configurações da agenda → "Integrar agenda" → ID).
   - Agenda principal de um Gmail = o próprio e-mail.
   - Agenda secundária = algo como `...@group.calendar.google.com`.
3. Cole esse ID no `calendar_id` daquele profissional no `dados.json`.

> Sem isso, os horários até aparecem, mas a **confirmação do agendamento falha**
> (a leitura de uma agenda sem acesso retorna "tudo livre"; a gravação exige acesso
> real). É o erro mais comum de "horário aparece mas não confirma".

### Passo 4 — WhatsApp (se o plano do cliente tiver)
1. No manager da Evolution (`http://192.168.1.100:8080/manager`), crie uma
   **instância** com o nome **exatamente igual** ao `WHATSAPP_INSTANCE` do `.env`
   (no nosso caso, `carol`) e **conecte** o número do cliente (escaneando o QR).
2. No `clientes/carol/.env`, confira que existe:
   ```
   WHATSAPP_API_TOKEN=<a MESMA chave do Evolution_Global/.env>
   ```
   (O código lê a chave dessa variável. Se faltar, a Evolution responde 401 e a
   mensagem não sai.)
3. Configure o **webhook** dessa instância no manager:
   - **URL:** `http://carol-app:3000/webhook-whatsapp`
     (nome do container = `<cliente>-app`; porta **3000**, que é a interna.)
   - Em **Events**, marque **MESSAGES_UPSERT** (ou "Mark All"). Sem isso, o webhook
     não dispara e o cliente não consegue confirmar respondendo "1".

### Passo 5 — Subir (1 comando)
```bash
cd ~/Agendamento
sudo ./atualizar-cliente.sh carol
```
Faz `up` + `seed` (popula do `dados.json`) + `restart`. No fim mostra a URL de
teste, ex.: `http://192.168.1.100:8092`. Abra e confira o visual e os horários.

### Passo 6 — Cloudflare (colocar no subdomínio)
Ver a seção **6. Cloudflare** abaixo (DNS + ingress). Em resumo, três comandos:
```bash
# 1) cria o DNS do subdomínio (não mexe no túnel, é seguro)
sudo HOME=/DATA/cloudflared cloudflared tunnel route dns agendamento carol.deadzone.com.br

# 2) backup do config antes de editar (produção!)
sudo cp /etc/cloudflared/config.yml /etc/cloudflared/config.yml.bak

# 3) adicione a rota no ingress (ver seção 6) e reinicie:
sudo systemctl restart cloudflared
```

### Passo 7 — Testar
- `https://carol.deadzone.com.br` → abre o site da Carol.
- Faz um agendamento de teste → evento aparece no Google e a mensagem chega no
  WhatsApp.
- Responde "1" na mensagem → o agendamento confirma (testa o webhook).

---

## 5. Operação do dia a dia — as 3 regras "mexeu em X"

| Mexeu em... | O que fazer | Comando |
|---|---|---|
| **Dados** de um cliente (`dados.json`) | re-seed + restart | `sudo ./atualizar-cliente.sh <slug>` |
| **Código** (qualquer coisa em `/app`) | rebuild da imagem + recriar os containers | ver abaixo |
| **Só o `.env`** de um cliente | recriar o container | `docker compose up -d --force-recreate` (na pasta do cliente) |

**Quando mudar o código (`/app`):**
```bash
# 1) reconstrói a imagem única
cd ~/Agendamento/app
sudo env DOCKER_CONFIG=/DATA/.docker docker build -t motor-agendamento:v1 .

# 2) recria os containers de CADA cliente para usarem a imagem nova
cd ~/Agendamento/clientes/bya
sudo env DOCKER_CONFIG=/DATA/.docker docker compose up -d
# ...repita para navalha_de_ouro, carol, etc.
```

> **Por quê `up -d` e não `restart`?** O `restart` reinicia o mesmo container e
> **não** recarrega `.env` nem imagem. Para pegar `.env` novo ou imagem nova, é
> preciso **recriar** o container — isso é o `up -d` (use `--force-recreate` se
> mudou só o `.env`, para garantir).

---

## 6. Cloudflare — apontar um subdomínio para cada cliente

Há **duas peças** (as duas precisam existir):
1. **DNS** — diz que o subdomínio pertence a este túnel. Criado uma vez por cliente.
2. **Ingress** — regra no `config.yml` que manda quem chega no hostname para a porta.

Dados do túnel: nome `agendamento`, ID `d6f1e2aa-6d7f-49ba-b7c1-6486f80e2b4b`,
config em `/etc/cloudflared/config.yml`.

### 6.1 Criar o DNS (seguro, não toca no túnel)
```bash
sudo HOME=/DATA/cloudflared cloudflared tunnel route dns agendamento carol.deadzone.com.br
```

### 6.2 Editar o ingress
**Sempre faça backup antes** (é produção):
```bash
sudo cp /etc/cloudflared/config.yml /etc/cloudflared/config.yml.bak
```

O `config.yml` deve ficar assim — cada cliente novo entra **acima** do
`http_status:404` (a regra "pega-tudo", que é **sempre a última**):

```yaml
tunnel: agendamento
credentials-file: /DATA/cloudflared/.cloudflared/d6f1e2aa-6d7f-49ba-b7c1-6486f80e2b4b.json

ingress:
  - hostname: agendamento.deadzone.com.br
    service: http://192.168.1.100:8090
  - hostname: navalha.deadzone.com.br
    service: http://192.168.1.100:8091
  - hostname: carol.deadzone.com.br
    service: http://192.168.1.100:8092
  - service: http_status:404
```

> **Atenção (YAML é chato com espaço):** indentação por **espaços**, não tab. Se
> errar a indentação, o túnel inteiro cai. Por isso o backup do `.bak`.

### 6.3 Aplicar e conferir
```bash
sudo systemctl restart cloudflared
sudo systemctl status cloudflared      # tem que voltar "active (running)"
```

### 6.4 Se a Navalha/Carol não abrir mas a Bya continuar de pé
Quase sempre é uma destas:
- **DNS ainda propagando** — espere 1–2 min.
- **Container do cliente fora do ar** — teste direto pelo IP:porta
  (`http://192.168.1.100:8092`). Se também não abre, o problema é no container, não
  no Cloudflare.

Para reverter rápido: `sudo cp /etc/cloudflared/config.yml.bak /etc/cloudflared/config.yml && sudo systemctl restart cloudflared`.

---

## 7. WhatsApp (Evolution) — referência

- **Uma Evolution para todos** (`Evolution_Global`), na porta 8080. Cada cliente tem
  uma **instância** (nome = `WHATSAPP_INSTANCE`).
- **Enviar** (app → Evolution): o código (`whatsapp.js`) chama
  `WHATSAPP_API_URL/message/sendText/<instância>` com o header `apikey:
  WHATSAPP_API_TOKEN`. **Por isso `WHATSAPP_API_TOKEN` no `.env` do cliente precisa
  ser a mesma chave do `Evolution_Global/.env`.**
- **Receber** (Evolution → app): a Evolution chama o webhook
  `http://<cliente>-app:3000/webhook-whatsapp` quando o cliente responde. O app
  trata "1/2/3" para confirmar/cancelar. Precisa do evento **MESSAGES_UPSERT** ligado.

Variáveis de WhatsApp no `.env` do cliente:
```
WHATSAPP_PROVIDER=evolution
WHATSAPP_API_URL=http://evolution-api:8080      # nome na rede agenda-net
WHATSAPP_API_TOKEN=<chave mestre da Evolution>  # o código lê ESTA variável
WHATSAPP_INSTANCE=<slug do cliente>             # = nome da instância no manager
LEMBRETE_VESPERA_HORA=21
```

---

## 8. Google Calendar — referência

- **Uma** service account para o sistema todo:
  `calendar-bot@agenda-de-servicos-498211.iam.gserviceaccount.com`
  (projeto `agenda-de-servicos-498211`). O arquivo `app/credentials.json` é dela.
- Para cada profissional, o cliente **compartilha a agenda** com essa conta, com
  **"Fazer alterações nos eventos"**, e o `calendar_id` vai no `dados.json`.
- Vantagem do modelo: não se cria conta nova por cliente — só se compartilha a agenda.

---

## 9. Troubleshooting (problemas reais já vividos)

| Sintoma | Causa | Solução |
|---|---|---|
| `docker build` → `requires exactly 1 argument` | faltou o `.` no fim | `docker build -t motor-agendamento:v1 .` |
| `mkdir /root/.docker: read-only file system` | faltou o `DOCKER_CONFIG` | prefixe com `sudo env DOCKER_CONFIG=/DATA/.docker` |
| `Permission denied` em `mkdir`/`mv`/`docker` | faltou `sudo` | use `sudo` |
| WhatsApp **não envia** | `WHATSAPP_API_TOKEN` ausente/errado → 401 | pôr a chave no `.env` + `up -d --force-recreate` |
| WhatsApp **não envia** | `WHATSAPP_INSTANCE` ≠ nome no manager → 404 | igualar os dois nomes |
| WhatsApp **não recebe** resposta | webhook com nome de container antigo, ou `MESSAGES_UPSERT` off | URL `http://<slug>-app:3000/webhook-whatsapp` + ligar o evento |
| Horário aparece mas **não confirma** | `calendar_id` placeholder ou agenda não compartilhada | agenda real compartilhada com a SA + `atualizar-cliente.sh` |
| Script `.sh` → `bad interpreter` no Linux | salvo no Windows com fim de linha CRLF | `.gitattributes` com `*.sh text eol=lf` |
| `up` recusa por porta | `PORTA_EXTERNA` repetida com outro cliente | usar porta única |
| Cliente não abre no subdomínio mas IP:porta sim | DNS propagando ou ingress errado | esperar / conferir `config.yml` (ver seção 6.4) |

---

## 10. Manutenção recorrente

- **`CONFIG_SESSION_PHONE_VERSION`** (em `Evolution_Global/.env`) **expira** (a atual
  vale até ~**02/08/2026**). Quando o QR parar de conectar, atualize esse valor para
  a versão atual do WhatsApp Web e suba a Evolution de novo.
- **Backup dos bancos:** copie periodicamente as pastas `clientes/*/banco_dados/`
  (são os agendamentos reais de cada cliente). Perder isso não tem desfazer.
- **Git:** `banco_dados/`, `fotos/`, `.env` e `credentials.json` **nunca** vão para o
  repositório (já cobertos pelo `.gitignore`). Versione `/app`, o `_template` e os
  `dados.json`/`docker-compose.yml` de cada cliente.

---

## 11. Referência rápida de comandos

```bash
# --- imagem (rodar quando mudar o código em /app) ---
cd ~/Agendamento/app
sudo env DOCKER_CONFIG=/DATA/.docker docker build -t motor-agendamento:v1 .

# --- cliente novo ---
sudo ./novo-cliente.sh <slug> <porta> <tema>      # cria estrutura
#   (editar clientes/<slug>/dados.json + fotos)
sudo ./atualizar-cliente.sh <slug>                # sobe + seed + restart

# --- operação ---
# mudou dados.json:
sudo ./atualizar-cliente.sh <slug>
# mudou só .env (na pasta do cliente):
sudo env DOCKER_CONFIG=/DATA/.docker docker compose up -d --force-recreate
# ver logs de um cliente:
sudo env DOCKER_CONFIG=/DATA/.docker docker logs --tail 50 <slug>-app

# --- Cloudflare (cliente novo) ---
sudo HOME=/DATA/cloudflared cloudflared tunnel route dns agendamento <sub>.deadzone.com.br
sudo cp /etc/cloudflared/config.yml /etc/cloudflared/config.yml.bak
#   (editar /etc/cloudflared/config.yml: rota acima do http_status:404)
sudo systemctl restart cloudflared

# --- Evolution global ---
cd ~/Agendamento/Evolution_Global
sudo env DOCKER_CONFIG=/DATA/.docker docker compose up -d
#   manager: http://192.168.1.100:8080/manager
```

---

*Dados do ambiente: servidor ZimaOS em `192.168.1.100`; pasta `~/Agendamento`; túnel
Cloudflare `agendamento` (domínio `deadzone.com.br`); repo
`github.com/Parllon/Agenda_de_Servicos`.*