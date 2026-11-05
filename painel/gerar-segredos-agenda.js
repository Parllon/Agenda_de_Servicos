// gerar-segredos-agenda.js — roda UMA vez para os clientes que já existiam antes
// da "agenda por assinatura" (iPhone/iCloud):
//   - AGENDA_ICS_SEGREDO: cria para quem não tem (nunca troca um existente —
//     trocar invalida os links que o dono já assinou).
//   - CADASTRO_PROTOCOLO: para clientes vindos do cadastro do site, copia o
//     protocolo do registro em painel/pedidos/ (o motor usa para responder o "oi").
// Não mexe em mais nada do .env.
//
// Depois de rodar: em cada cliente alterado, `docker compose up -d --force-recreate`
// (restart NÃO recarrega o .env). O script imprime a lista.
//
// Uso: sudo env DOCKER_CONFIG=/DATA/.docker docker exec painel-slotme node gerar-segredos-agenda.js [--simular]

'use strict';
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const C = require('./lib/clientes');
const Pedidos = require('./lib/pedidos-store');
const { parseEnv, updateEnv } = require('./lib/env');
const { novoSegredo } = require('./lib/agenda-links');

const SIMULAR = process.argv.includes('--simular');
const protocoloPorSlug = Object.fromEntries(
  Pedidos.listar().filter((r) => r.status === 'pronto').map((r) => [r.slug, r.protocolo]),
);

const alterados = [];
for (const { slug } of C.listar()) {
  const arq = path.join(C.dirCliente(slug), '.env');
  const texto = fs.readFileSync(arq, 'utf8');
  const env = parseEnv(texto);
  const mudar = {};
  if (!env.AGENDA_ICS_SEGREDO) mudar.AGENDA_ICS_SEGREDO = novoSegredo();
  if (!env.CADASTRO_PROTOCOLO && protocoloPorSlug[slug]) mudar.CADASTRO_PROTOCOLO = protocoloPorSlug[slug];
  const chaves = Object.keys(mudar);
  if (!chaves.length) { console.log(`  ok      ${slug}`); continue; }
  if (!SIMULAR) fs.writeFileSync(arq, updateEnv(texto, mudar), 'utf8');
  console.log(`  ${SIMULAR ? 'faria  ' : 'feito  '} ${slug}: ${chaves.join(', ')}`);
  alterados.push(slug);
}
console.log(`\n${SIMULAR ? '[simulação] ' : ''}clientes alterados: ${alterados.join(' ') || 'nenhum'}`);
