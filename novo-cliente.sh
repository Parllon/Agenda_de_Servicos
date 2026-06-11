#!/usr/bin/env bash
# novo-cliente.sh — cria a estrutura de um cliente novo a partir do _template.
# Uso:  sudo ./novo-cliente.sh <slug> <porta> <tema>
#   slug  = nome curto, sem espaços (vira a pasta e o nome dos containers). ex: carol
#   porta = porta externa única, não pode repetir com outro cliente.        ex: 8092
#   tema  = manicure | barbearia
set -euo pipefail

RAIZ="$(cd "$(dirname "$0")" && pwd)"
TEMPLATE="$RAIZ/clientes/_template"

SLUG="${1:-}"; PORTA="${2:-}"; TEMA="${3:-}"

if [[ -z "$SLUG" || -z "$PORTA" || -z "$TEMA" ]]; then
  echo "Uso: sudo ./novo-cliente.sh <slug> <porta> <tema>"
  echo "Ex.: sudo ./novo-cliente.sh carol 8092 manicure"
  exit 1
fi
if [[ "$TEMA" != "manicure" && "$TEMA" != "barbearia" ]]; then
  echo "ERRO: tema deve ser 'manicure' ou 'barbearia' (recebi '$TEMA')."; exit 1
fi
DIR="$RAIZ/clientes/$SLUG"
if [[ -e "$DIR" ]]; then
  echo "ERRO: clientes/$SLUG já existe. Use outro slug ou apague a pasta."; exit 1
fi
if [[ ! -d "$TEMPLATE" ]]; then
  echo "ERRO: molde não encontrado em $TEMPLATE."; exit 1
fi

cp -r "$TEMPLATE" "$DIR"
mkdir -p "$DIR/banco_dados" "$DIR/fotos"

sed -i "s/^CLIENTE=.*/CLIENTE=$SLUG/"                     "$DIR/.env"
sed -i "s/^PORTA_EXTERNA=.*/PORTA_EXTERNA=$PORTA/"        "$DIR/.env"
sed -i "s/^TEMA=.*/TEMA=$TEMA/"                           "$DIR/.env"
sed -i "s/^WHATSAPP_INSTANCE=.*/WHATSAPP_INSTANCE=$SLUG/" "$DIR/.env"

echo ""
echo "Cliente '$SLUG' criado em clientes/$SLUG  (porta $PORTA, tema $TEMA)."
echo ""
echo "ANTES de subir:"
echo "  1) edite  clientes/$SLUG/dados.json  (nome, profissionais, serviços, agendas)"
echo "  2) ponha as fotos em  clientes/$SLUG/fotos/  (se usar foto_url no dados.json)"
echo ""
echo "Depois suba com:  sudo ./atualizar-cliente.sh $SLUG"
