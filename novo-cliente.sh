#!/usr/bin/env bash
# novo-cliente.sh — cria a estrutura de um cliente novo a partir do _template.
# Uso:  sudo ./novo-cliente.sh <slug> <porta> <tema> [perfil]
#   slug  = nome curto, sem espaços (vira a pasta e o nome dos containers). ex: carol
#   porta = porta externa única, não pode repetir com outro cliente.        ex: 8092
#   tema  = visual da interface (tema_1 a tema_7):
#     tema_1 — Feminino Clássico   (vinho + marfim)             → manicure, nail designer
#     tema_2 — Masculino Clássico  (preto + dourado)             → barbearia tradicional
#     tema_3 — Spa & Estética      (verde esmeralda + branco)    → spa, massagem, estética
#     tema_4 — Hair Salon          (rosa cerise + branco)        → cabeleireiro, coloração
#     tema_5 — Beauty Studio       (nude + caramelo)             → lash, sobrancelha, micropig
#     tema_6 — Ink & Art           (preto profundo + vermelho)   → tatuagem, piercing
#     tema_7 — Luxo Premium        (branco pérola + champagne)   → salão premium, clínica
#   perfil = vocabulário do profissional na interface (opcional, padrão: profissional):
#     profissional | barbeiro | terapeuta | cabeleireiro | designer | tatuador | especialista
set -euo pipefail

RAIZ="$(cd "$(dirname "$0")" && pwd)"
TEMPLATE="$RAIZ/clientes/_template"

SLUG="${1:-}"; PORTA="${2:-}"; TEMA="${3:-}"; PERFIL="${4:-profissional}"

if [[ -z "$SLUG" || -z "$PORTA" || -z "$TEMA" ]]; then
  echo "Uso: sudo ./novo-cliente.sh <slug> <porta> <tema> [perfil]"
  echo "Ex.: sudo ./novo-cliente.sh carol 8092 tema_1 cabeleireiro"
  exit 1
fi
TEMAS_VALIDOS="tema_1 tema_2 tema_3 tema_4 tema_5 tema_6 tema_7"
if ! echo "$TEMAS_VALIDOS" | grep -qw "$TEMA"; then
  echo "ERRO: tema inválido ('$TEMA'). Use um de: $TEMAS_VALIDOS"; exit 1
fi
PERFIS_VALIDOS="profissional barbeiro terapeuta cabeleireiro designer tatuador especialista"
if ! echo "$PERFIS_VALIDOS" | grep -qw "$PERFIL"; then
  echo "ERRO: perfil inválido ('$PERFIL'). Use um de: $PERFIS_VALIDOS"; exit 1
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
sed -i "s/^TEMA=.*/TEMA=$TEMA/"                                       "$DIR/.env"
sed -i "s/^PERFIL_PROFISSIONAL=.*/PERFIL_PROFISSIONAL=$PERFIL/"       "$DIR/.env"
sed -i "s/^WHATSAPP_INSTANCE=.*/WHATSAPP_INSTANCE=$SLUG/"             "$DIR/.env"

echo ""
echo "Cliente '$SLUG' criado em clientes/$SLUG  (porta $PORTA, tema $TEMA, perfil $PERFIL)."
echo ""
echo "ANTES de subir:"
echo "  1) edite  clientes/$SLUG/dados.json  (nome, profissionais, serviços, agendas)"
echo "  2) ponha as fotos em  clientes/$SLUG/fotos/  (se usar foto_url no dados.json)"
echo ""
echo "Depois suba com:  sudo ./atualizar-cliente.sh $SLUG"
