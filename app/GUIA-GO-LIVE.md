# Guia de Go-Live — agendamento.deadzone.com.br

Objetivo: deixar o sistema acessível na internet pelo subdomínio
`agendamento.deadzone.com.br`, via Cloudflare Tunnel (sem abrir portas no
roteador), com as configurações de produção corrigidas.

Faça na ordem. Cada bloco tem o comando e o "por quê".

---

## PARTE 0 — Verificação (o que já existe?)

Antes de instalar, descubra o estado atual. Rode e anote o resultado:

```bash
# cloudflared instalado?
which cloudflared && cloudflared --version

# algum container cloudflare rodando?
sudo docker ps -a | grep -i cloudflare

# já existe algum tunnel na conta?
cloudflared tunnel list

# o app responde localmente?
curl -I http://192.168.1.100:8090
```

- Se `cloudflared` não existe → siga a PARTE 1.
- Se já existe e há um tunnel criado → pule pra PARTE 3 (configurar o subdomínio).
- O `curl` no app deve dar `HTTP/1.1 200 OK`.

---

## PARTE 1 — Instalar o cloudflared no Zima

Recomendado rodar como **container Docker** (combina com o resto do seu setup
e sobe sozinho com o `restart: unless-stopped`). Mas a forma mais simples de
autenticar pela primeira vez é com o binário. Use o binário pra logar e criar,
depois (opcional) migra pra container.

### Opção binário (mais simples pra começar)

```bash
# baixa o cloudflared (arquitetura amd64; se o Zima for ARM, troque por arm64)
cd /tmp
curl -L --output cloudflared https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64
chmod +x cloudflared
sudo mv cloudflared /usr/local/bin/
cloudflared --version
```

> Se o `curl` falhar por causa do domínio do GitHub, baixe pelo navegador e
> transfira pro Zima. (O ambiente de rede do Zima costuma permitir github.com.)

---

## PARTE 2 — Autenticar e criar o tunnel

```bash
# 1) login: abre uma URL no navegador pra você autorizar na sua conta Cloudflare
cloudflared tunnel login
```

No navegador, **escolha o domínio `deadzone.com.br`**. Isso baixa um
certificado (`cert.pem`) pra `~/.cloudflared/`.

```bash
# 2) cria o tunnel (dê um nome claro)
cloudflared tunnel create agendamento
```

Isso gera um **ID de tunnel** e um arquivo de credenciais
`~/.cloudflared/<ID>.json`. **Anote o ID** — você vai usar no config.

```bash
# 3) confirma que foi criado
cloudflared tunnel list
```

---

## PARTE 3 — Ligar o subdomínio ao tunnel (DNS)

```bash
# cria o registro DNS agendamento.deadzone.com.br apontando pro tunnel
cloudflared tunnel route dns agendamento-patricia agendamento.deadzone.com.br
```

Isso cria automaticamente um registro CNAME na Cloudflare. Não precisa mexer no
painel da Cloudflare à mão.

---

## PARTE 4 — Arquivo de configuração do tunnel

Crie o arquivo `~/.cloudflared/config.yml`:

```bash
nano ~/.cloudflared/config.yml
```

Conteúdo (troque `<ID-DO-TUNNEL>` pelo ID real da PARTE 2):

```yaml
tunnel: <ID-DO-TUNNEL>
credentials-file: /root/.cloudflared/<ID-DO-TUNNEL>.json

ingress:
  - hostname: agendamento.deadzone.com.br
    service: http://192.168.1.100:8090
  - service: http_status:404
```

> O `ingress` diz: "tráfego pra agendamento.deadzone.com.br vai pro app no
> 8090; qualquer outra coisa, responde 404". A última linha (catch-all) é
> obrigatória.

Teste rodando em primeiro plano (pra ver erros na hora):

```bash
cloudflared tunnel run agendamento-patricia
```

Abra `https://agendamento.deadzone.com.br` no navegador. Se a landing
aparecer, FUNCIONOU. Pare com Ctrl+C (ainda não está como serviço).

---

## PARTE 5 — Deixar o tunnel rodando sempre (serviço)

Pra subir sozinho quando o Zima reiniciar:

```bash
sudo cloudflared service install
sudo systemctl enable cloudflared
sudo systemctl start cloudflared
sudo systemctl status cloudflared   # deve mostrar "active (running)"
```

---

## PARTE 6 — AJUSTES DE PRODUÇÃO (CRÍTICO!) ⚠️

Assim que o link fica público, estas configs DEIXAM de ser opcionais.
NÃO PULE. A boa notícia: agora é quase tudo num lugar só (o `.env`).

### 6.1 — Editar o .env com TODOS os valores de produção

Edite o `.env` no Zima:

```bash
nano .env
```

Adicione/ajuste estas linhas (revise cada uma):

```env
# --- Domínio público ---
# Link da landing que vai no WhatsApp de reagendamento.
# HOJE aponta pro IP local — de fora da sua casa, o link quebra.
LANDING_URL=https://agendamento.deadzone.com.br

# Só este domínio pode chamar a API pelo navegador (segurança).
# HOJE vazio = libera tudo (ok só em rede local).
CORS_ORIGIN=https://agendamento.deadzone.com.br

# --- Expediente e folga (agora no .env, sem mexer no código) ---
# Horário de atendimento (hora cheia, 0-23).
EXPEDIENTE_INICIO=9
EXPEDIENTE_FIM=19

# Dias de folga (0=dom, 1=seg ... 6=sáb), separados por vírgula.
# IMPORTANTE: você deixou domingo ABERTO pra testar (FOLGAS vazio).
# Em produção, FECHE o domingo: FOLGAS=0
# (vazio = abre todos os dias; ausente = padrão seguro [0])
FOLGAS=0

# --- WhatsApp: delays conservadores (anti-ban) ---
# Se baixou pra testar rápido, volte pros valores seguros em produção.
ENVIO_DELAY_MIN_MS=3000
ENVIO_DELAY_MAX_MS=12000
ENVIO_LOTE_MIN_MS=30000
ENVIO_LOTE_MAX_MS=120000
```

> NOTA: o `EXPEDIENTE` e o `FOLGAS` NÃO ficam mais no `server.js` — foram
> movidos pro `.env`. Não precisa editar código pra mudar horário/folga.

### 6.2 — Aplicar as mudanças

Como mudou só o `.env` (não o código), basta REINICIAR — não precisa rebuild:

```bash
cd ~/Agendamento
sudo env DOCKER_CONFIG=/DATA/.docker docker compose -f docker-compose.full.yml up -d
```

> Se você TAMBÉM mexeu em algum arquivo de código (.js), aí sim use `--build`:
> `... docker compose -f docker-compose.full.yml up -d --build`

---

## PARTE 7 — Testes finais (de fora da sua casa)

Faça pelo CELULAR na rede móvel (4G/5G, NÃO no Wi-Fi de casa) — isso prova
que está acessível pela internet de verdade.

1. Abra `https://agendamento.deadzone.com.br` → landing carrega.
2. Faça um agendamento de teste completo.
3. Confira o WhatsApp: a confirmação chega? O link de reagendamento aponta
   pra `agendamento.deadzone.com.br` (e não pro IP)?
4. Responda "2" (reagendar) → a mensagem traz o link público clicável?
5. Tente agendar num domingo → deve dizer "Sem atendimento neste dia".

Se tudo passar: ESTÁ NO AR. 🎉

---

## Observações importantes

- **Webhook do WhatsApp continua interno.** O webhook da Evolution aponta pra
  `http://agendamento-api:3000/webhook-whatsapp` (rede interna do Docker).
  NÃO muda com o tunnel — o tunnel é só pra landing pública. Não mexa nisso.
- **Evolution manager (8080) NÃO deve ir pro tunnel.** Só a landing (8090) fica
  pública. O painel da Evolution continua acessível só na rede local.
- **HTTPS é automático** pela Cloudflare. Você não precisa configurar certificado.
- **Credenciais (Google + Evolution):** se for trocar por motivo de segurança,
  faça com calma DEPOIS de confirmar que tudo funciona — uma mudança de cada vez.