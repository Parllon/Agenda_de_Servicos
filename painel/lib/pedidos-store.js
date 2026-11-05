// pedidos-store.js — registro em disco dos pedidos que chegam do site SlotMe.
// Um JSON por pedido em <PROJETO_RAIZ>/painel/pedidos/<protocolo>.json.
// Serve de auditoria (quem pediu, o que aconteceu em cada fase) e para
// reprocessar um pedido que falhou ou ficou "aguardando".
// NUNCA versionar esta pasta: tem nome, e-mail e WhatsApp de pessoas (.gitignore).

'use strict';
const fs = require('fs');
const path = require('path');
const C = require('./clientes');

const DIR = path.join(C.PROJETO_RAIZ, 'painel', 'pedidos');
const PROTOCOLO = /^SLT-[A-Z0-9]{6}$/;
const DIAS_TESTE = 30;

function caminho(protocolo) {
  if (!PROTOCOLO.test(protocolo || '')) throw new Error('protocolo inválido');
  return path.join(DIR, `${protocolo}.json`);
}

function ler(protocolo) {
  try { return JSON.parse(fs.readFileSync(caminho(protocolo), 'utf8')); }
  catch (e) { if (e.code === 'ENOENT' || e.message === 'protocolo inválido') return null; throw e; }
}

function gravar(reg) {
  fs.mkdirSync(DIR, { recursive: true });
  reg.atualizado_em = new Date().toISOString();
  // grava num temporário e renomeia: um crash no meio nunca deixa JSON pela metade
  const destino = caminho(reg.protocolo);
  const tmp = `${destino}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(reg, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, destino);
  return reg;
}

function listar() {
  if (!fs.existsSync(DIR)) return [];
  return fs.readdirSync(DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => { try { return JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8')); } catch { return null; } })
    .filter(Boolean)
    .sort((a, b) => String(b.criado_em).localeCompare(String(a.criado_em)));
}

// Novo registro. `pedido` já deve vir SEM as fotos (elas vão direto para fotos/).
function novo({ pedido, slug, url, status }) {
  const agora = new Date();
  const trial = new Date(agora.getTime() + DIAS_TESTE * 24 * 60 * 60 * 1000);
  return gravar({
    protocolo: pedido.protocolo,
    status, // recebido | aguardando | provisionando | pronto | erro
    slug,
    url,
    porta: null,
    contato: {
      nome: pedido.contato.nome,
      email: pedido.contato.email_google.toLowerCase(),
      whatsapp: pedido.contato.whatsapp,
    },
    fases: {},
    avisos: [],
    erro: null,
    criado_em: agora.toISOString(),
    trial_ate: trial.toISOString(),
    pedido,
  });
}

// Já existe pedido (não descartado por erro) com este e-mail ou WhatsApp?
function duplicado({ email, whatsapp }) {
  const e = String(email || '').toLowerCase();
  return listar().find((r) => r.status !== 'erro'
    && (r.contato.email === e || r.contato.whatsapp === whatsapp)) || null;
}

// Quantos pedidos foram provisionados (ou estão provisionando) nas últimas 24h.
function provisionadosUltimas24h() {
  const limite = Date.now() - 24 * 60 * 60 * 1000;
  return listar().filter((r) => ['recebido', 'provisionando', 'pronto'].includes(r.status)
    && Date.parse(r.criado_em) >= limite).length;
}

module.exports = { ler, gravar, listar, novo, duplicado, provisionadosUltimas24h, DIR };
