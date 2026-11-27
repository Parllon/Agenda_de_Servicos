// gerar-tokens-webhook.js — cria o WEBHOOK_TOKEN dos clientes que ainda não têm
// (nunca troca um existente). Não mexe em mais nada do .env e não imprime senhas.
//
// Depois de rodar: em cada cliente alterado, `docker compose up -d --force-recreate`
// (restart NÃO recarrega o .env). Cliente sem senha recusa tudo o que vem do WhatsApp.
//
// Uso: sudo env DOCKER_CONFIG=/DATA/.docker docker exec painel-slotme node gerar-tokens-webhook.js [--simular]

'use strict';
require('dotenv').config();
const { completarTokens } = require('./lib/tokens-webhook');

const SIMULAR = process.argv.includes('--simular');
const { alterados, semToken } = completarTokens({ simular: SIMULAR });

console.log(`${SIMULAR ? '[simulação] receberiam senha' : 'receberam senha'}: ${alterados.join(' ') || 'nenhum'}`);
if (SIMULAR) process.exit(0);

if (alterados.length) console.log(`Recrie com "up -d --force-recreate": ${alterados.join(' ')}`);
if (semToken.length) {
  console.error(`ATENÇÃO: continuam SEM senha: ${semToken.join(' ')} — não recrie os salões antes de resolver.`);
  process.exit(1);
}
console.log('Todos os clientes têm senha.');
