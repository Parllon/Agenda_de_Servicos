// agenda-links.js — links da "agenda por assinatura" (iPhone/iCloud) de um cliente.
// MESMO cálculo do motor (app/agenda-ics.js → tokenDe). Duplicado de propósito:
// painel e motor são containers separados, não compartilham require().

'use strict';
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const C = require('./clientes');
const { parseEnv } = require('./env');

const DOMINIO = 'agendamentos.app.br';

function tokenDe(segredo, alvo) {
  return crypto.createHmac('sha256', segredo).update(String(alvo)).digest('hex').slice(0, 32);
}

function novoSegredo() {
  return crypto.randomBytes(32).toString('hex');
}

function segredoDo(slug) {
  const env = parseEnv(fs.readFileSync(path.join(C.dirCliente(slug), '.env'), 'utf8'));
  return env.AGENDA_ICS_SEGREDO || '';
}

// Link https (página /assinar do próprio cliente) — é o que vai por WhatsApp.
function linkAssinar(slug, segredo, alvo = 'todos') {
  return `https://${slug}.${DOMINIO}/assinar/${tokenDe(segredo, alvo)}`;
}

// { ativo, dono, profissionais: [{ id, nome, url }] }
function linksDoCliente(slug) {
  const segredo = segredoDo(slug);
  if (!segredo) return { ativo: false, dono: '', profissionais: [] };
  const { dados } = C.ler(slug);
  return {
    ativo: true,
    dono: linkAssinar(slug, segredo, 'todos'),
    profissionais: (dados.profissionais || []).map((p) => ({
      id: p.id, nome: p.nome, url: linkAssinar(slug, segredo, `prof:${p.id}`),
    })),
  };
}

module.exports = { tokenDe, novoSegredo, segredoDo, linkAssinar, linksDoCliente };
