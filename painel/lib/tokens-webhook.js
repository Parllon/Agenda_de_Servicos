// tokens-webhook.js — garante o WEBHOOK_TOKEN de cada cliente. Sem ele o motor
// recusa (403) tudo o que chega pelo WhatsApp: respostas 1/2/3 e o "oi" do dono.

'use strict';
const fs = require('fs');
const path = require('path');
const C = require('./clientes');
const { parseEnv, updateEnv } = require('./env');
const { novoSegredo } = require('./agenda-links');

// Cria a senha de quem não tem; nunca troca uma existente (o distribuidor e o
// motor precisam concordar). Devolve { alterados, semToken }, em que semToken é
// quem CONTINUA sem senha ao final (na simulação, quem está sem hoje).
function completarTokens({ simular = false } = {}) {
  const alterados = [];
  const semToken = [];
  for (const { slug } of C.listar()) {
    if (!C.existe(slug)) continue; // pasta sem .env não é cliente
    const arq = path.join(C.dirCliente(slug), '.env');
    try {
      const texto = fs.readFileSync(arq, 'utf8');
      if (parseEnv(texto).WEBHOOK_TOKEN) continue;
      if (!simular) fs.writeFileSync(arq, updateEnv(texto, { WEBHOOK_TOKEN: novoSegredo() }), 'utf8');
      alterados.push(slug);
      if (simular) semToken.push(slug);
    } catch (e) {
      console.error(`[tokens] ${slug}: ${e.message}`);
      semToken.push(slug);
    }
  }
  return { alterados, semToken };
}

module.exports = { completarTokens };
