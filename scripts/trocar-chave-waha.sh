#!/usr/bin/env bash
# trocar-chave-waha.sh — gera uma chave nova para o WAHA e atualiza quem a usa:
# waha/.env, painel/.env e o .env de cada cliente que já tinha WAHA_API_KEY.
#
# Uso (no SSH do Zima, DEPOIS do git pull):
#   sudo bash scripts/trocar-chave-waha.sh             # só SIMULA, não altera nada
#   sudo bash scripts/trocar-chave-waha.sh --aplicar   # troca de verdade
#
# --ignorar-outros: troca mesmo havendo um container fora deste projeto usando a
# chave (ele vai parar de conseguir falar com o WAHA até ser atualizado à mão).
#
# Nunca imprime chave na tela. Pode ser rodado de novo se parar no meio.
set -euo pipefail

RAIZ="$(cd "$(dirname "$0")/.." && pwd)"
export DOCKER_CONFIG="${DOCKER_CONFIG:-/DATA/.docker}"
WAHA_LOCAL="http://localhost:21465/api/sessions/agendamento"
ESPERA_SEG="${ESPERA_SEG:-5}"   # intervalo entre tentativas ao conferir a sessão

APLICAR=0; IGNORAR_OUTROS=0
for a in "$@"; do
  case "$a" in
    --aplicar) APLICAR=1 ;;
    --ignorar-outros) IGNORAR_OUTROS=1 ;;
    *) echo "Opção desconhecida: $a"; exit 1 ;;
  esac
done

erro() { echo "ERRO: $*" >&2; exit 1; }

# ---------- 1) conferências (nada é alterado aqui) ----------
grep -q 'WAHA_API_KEY' "$RAIZ/waha/docker-compose.yml" 2>/dev/null \
  || erro "waha/docker-compose.yml ainda não lê a chave do .env. Rode 'git pull' em $RAIZ antes."
[[ -f "$RAIZ/painel/.env" ]] || erro "não achei $RAIZ/painel/.env."

ANTIGA="$(docker inspect waha --format '{{range .Config.Env}}{{println .}}{{end}}' \
  | sed -n 's/^WHATSAPP_API_KEY=//p' | tr -d '\r' | head -n1)"
[[ -n "$ANTIGA" ]] || erro "não consegui ler a chave atual do container 'waha'. Ele está criado?"

# Arquivos que serão atualizados. O _template é versionado no Git: fica de fora.
ARQUIVOS=("$RAIZ/painel/.env")
DIRS_CLIENTES=()
ESPERADOS=" waha painel-slotme "
for env in "$RAIZ"/clientes/*/.env; do
  [[ -f "$env" ]] || continue
  dir="$(dirname "$env")"
  [[ "$(basename "$dir")" == "_template" ]] && continue
  grep -q '^WAHA_API_KEY=' "$env" || continue
  ARQUIVOS+=("$env")
  DIRS_CLIENTES+=("$dir")
  nome="$(sed -n 's/^CLIENTE=\([A-Za-z0-9_.-]*\).*/\1/p' "$env" | head -n1)"
  ESPERADOS+="${nome}-app ${nome}-cron "
done

# Algum container fora desta lista usa a mesma chave? (ex.: outro projeto no servidor)
OUTROS=()
while IFS= read -r linha; do
  nome="${linha%%|*}"; nome="${nome#/}"
  [[ "$ESPERADOS" == *" $nome "* ]] || OUTROS+=("$nome")
done < <(docker inspect --format '{{.Name}}{{range .Config.Env}}|{{.}}{{end}}' $(docker ps -aq) \
           | grep -F -- "=$ANTIGA" || true)

echo "Arquivos .env que recebem a chave nova:"
for f in "${ARQUIVOS[@]}"; do echo "  - ${f#"$RAIZ"/}"; done
echo "  - waha/.env"

if [[ ${#OUTROS[@]} -gt 0 ]]; then
  echo
  echo "ATENÇÃO: containers fora deste projeto também usam a chave atual:"
  for o in "${OUTROS[@]}"; do echo "  - $o"; done
fi

if [[ $APLICAR -eq 0 ]]; then
  echo
  echo "SIMULAÇÃO: nada foi alterado. Para trocar de verdade, rode com --aplicar."
  exit 0
fi

if [[ ${#OUTROS[@]} -gt 0 && $IGNORAR_OUTROS -eq 0 ]]; then
  erro "parei sem alterar nada. Descubra como esses containers recebem a chave; depois rode com --ignorar-outros e atualize-os à mão."
fi

# ---------- 2) chave nova ----------
# Reaproveita a de waha/.env se for de uma tentativa anterior que não terminou.
NOVA="$(sed -n 's/^WAHA_API_KEY=//p' "$RAIZ/waha/.env" 2>/dev/null | tr -d '\r' | head -n1 || true)"
if [[ -z "$NOVA" || "$NOVA" == "$ANTIGA" ]]; then
  NOVA="$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')"
fi
[[ "$NOVA" =~ ^[A-Za-z0-9_-]{32,}$ ]] || erro "chave nova inválida; confira waha/.env."

# ---------- 3) arquivos (com backup) ----------
CARIMBO="$(date +%Y%m%d-%H%M%S)"
( umask 077; printf 'WAHA_API_KEY=%s\n' "$NOVA" > "$RAIZ/waha/.env" )
for f in "${ARQUIVOS[@]}"; do
  cp -p "$f" "$f.bak-$CARIMBO"
  if grep -q '^WAHA_API_KEY=' "$f"; then
    sed -i "s|^WAHA_API_KEY=.*|WAHA_API_KEY=$NOVA|" "$f"
  else
    printf '\nWAHA_API_KEY=%s\n' "$NOVA" >> "$f"
  fi
done
echo
echo "-> .env atualizados (backups com final .bak-$CARIMBO)"

# ---------- 4) containers (restart NÃO recarrega .env: precisa recriar) ----------
FALHARAM=()
echo "-> recriando o WAHA..."
( cd "$RAIZ/waha" && docker compose up -d --force-recreate )
echo "-> recriando o painel..."
( cd "$RAIZ/painel" && docker compose up -d --force-recreate ) || FALHARAM+=("painel")

for dir in ${DIRS_CLIENTES[@]+"${DIRS_CLIENTES[@]}"}; do
  slug="$(basename "$dir")"
  if [[ -n "$(cd "$dir" && docker compose ps -q)" ]]; then
    echo "-> recriando $slug..."
    ( cd "$dir" && docker compose up -d --force-recreate ) || FALHARAM+=("$slug")
  elif [[ -n "$(cd "$dir" && docker compose ps -aq)" ]]; then
    # Pausado: o "reativar" do painel só dá start, que manteria a chave antiga.
    echo "-> $slug está pausado: recriando sem ligar..."
    ( cd "$dir" && docker compose up --no-start --force-recreate ) || FALHARAM+=("$slug")
  else
    echo "-> $slug não tem container: só o .env foi atualizado."
  fi
done

# ---------- 5) conferência da sessão do WhatsApp ----------
echo "-> conferindo a sessão do WhatsApp (pode levar até 1 minuto)..."
CORPO="$(mktemp)"; trap 'rm -f "$CORPO"' EXIT
STATUS="sem resposta"
for tentativa in $(seq 1 24); do
  codigo="$(curl -s -o "$CORPO" -w '%{http_code}' -H "X-Api-Key: $NOVA" "$WAHA_LOCAL" || true)"
  if [[ "$codigo" == 200 ]]; then
    STATUS="$(sed -n 's/.*"status" *: *"\([A-Z_]*\)".*/\1/p' "$CORPO" | head -n1)"
    [[ "$STATUS" == WORKING ]] && break
    if [[ "$STATUS" == STOPPED ]]; then
      curl -s -o /dev/null -X POST -H "X-Api-Key: $NOVA" "$WAHA_LOCAL/start" || true
    fi
  fi
  sleep "$ESPERA_SEG"
done

echo
echo "Sessão do WhatsApp: $STATUS"
if grep -q 'webhook-dispatcher' "$CORPO" 2>/dev/null; then
  echo "Webhook (respostas 1/2/3): configurado na sessão."
else
  echo "ATENÇÃO: não vi o webhook na resposta da sessão. Teste respondendo 1/2/3 (doc §8.5)."
fi
[[ "$STATUS" == WORKING ]] || echo "ATENÇÃO: a sessão não está WORKING. Ver doc §8.7 (reconectar com QR)."
[[ ${#FALHARAM[@]} -eq 0 ]] || erro "falhou ao recriar: ${FALHARAM[*]}. Rode 'docker compose up -d --force-recreate' neles."
echo
echo "Depois de testar o envio, apague os backups (eles contêm segredos):"
echo "  sudo rm $RAIZ/painel/.env.bak-$CARIMBO $RAIZ/clientes/*/.env.bak-$CARIMBO"
[[ "$STATUS" == WORKING ]]
