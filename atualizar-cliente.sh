#!/usr/bin/env bash
# atualizar-cliente.sh — sobe (ou reaplica) um cliente: up + seed + restart.
# Use na 1ª subida E sempre que editar o dados.json do cliente.
# Uso:  sudo ./atualizar-cliente.sh <slug>
set -euo pipefail

RAIZ="$(cd "$(dirname "$0")" && pwd)"
SLUG="${1:-}"
DC="env DOCKER_CONFIG=/DATA/.docker docker compose"

if [[ -z "$SLUG" ]]; then
  echo "Uso: sudo ./atualizar-cliente.sh <slug>"; exit 1
fi
DIR="$RAIZ/clientes/$SLUG"
if [[ ! -d "$DIR" ]]; then
  echo "ERRO: clientes/$SLUG não existe. Crie com ./novo-cliente.sh primeiro."; exit 1
fi

cd "$DIR"
echo "-> subindo containers..."
$DC up -d
echo "-> populando o banco a partir do dados.json..."
$DC run --rm app node seed.js
echo "-> reiniciando para recarregar dados/agenda em memoria..."
$DC restart
PORTA=$(grep -E "^PORTA_EXTERNA=" .env | cut -d= -f2)
echo ""
echo "Cliente '$SLUG' no ar. Teste em: http://192.168.1.100:$PORTA"
