// metricas.js — banco central de eventos de landing page + agregação do funil.
// Landing page events -> metricas.db (lp_eventos)
// Scheduling funnel events -> cada cliente/*/banco_dados/agendamentos.db (eventos)
// O painel lê os bancos dos clientes em modo READ-ONLY (não escreve neles).

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const C = require('./clientes');

const DB_PATH = path.join(C.PROJETO_RAIZ, 'painel', 'metricas.db');

// Banco central de métricas (landing pages)
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.exec(`
  CREATE TABLE IF NOT EXISTS lp_eventos (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    slug      TEXT    NOT NULL,
    sessao_id TEXT    NOT NULL,
    tipo      TEXT    NOT NULL,
    criado_em TEXT    DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_lp_slug_tipo ON lp_eventos (slug, tipo, criado_em);
`);

// Cache de conexões read-only para os bancos dos clientes.
// Evita reabrir o mesmo arquivo a cada request.
const clienteDbCache = new Map();

function getClienteDb(slug) {
  if (clienteDbCache.has(slug)) return clienteDbCache.get(slug);
  const dbPath = path.join(C.PROJETO_RAIZ, 'clientes', slug, 'banco_dados', 'agendamentos.db');
  if (!fs.existsSync(dbPath)) return null;
  try {
    const cdb = new Database(dbPath, { readonly: true });
    clienteDbCache.set(slug, cdb);
    return cdb;
  } catch (e) {
    console.error(`[metricas] erro ao abrir DB de ${slug}:`, e.message);
    return null;
  }
}

// Verifica se a tabela eventos existe no banco do cliente (pode ser banco antigo).
function tabelaEventosExiste(cdb) {
  return !!cdb.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='eventos'").get();
}

// ------ Inserção de evento de landing page ------
function inserirLpEvento(slug, sessaoId, tipo) {
  db.prepare('INSERT INTO lp_eventos (slug, sessao_id, tipo) VALUES (?, ?, ?)').run(slug, sessaoId, tipo);
}

// ------ Aggregation ------
// Retorna um objeto por slug com contagens por tipo de evento + agendamentos.
// periodo: { inicio: 'YYYY-MM-DD', fim: 'YYYY-MM-DD' } — defaults para últimos 30 dias.
function getMetricas(slugs, inicio, fim) {
  const hoje = new Date();
  const fimDefault = hoje.toISOString().slice(0, 10);
  const inicioDefault = new Date(hoje.getTime() - 30 * 86400000).toISOString().slice(0, 10);

  const dtInicio = (inicio || inicioDefault) + ' 00:00:00';
  const dtFim = (fim || fimDefault) + ' 23:59:59';

  const resultado = {};

  const TIPOS_LP = ['lp_vista', 'lp_clicou_agendar', 'lp_clicou_whatsapp'];
  const TIPOS_FUNIL = [
    'pagina_vista', 'profissional_selecionado', 'servico_selecionado',
    'horario_selecionado', 'dados_preenchidos', 'agendamento_criado',
  ];

  if (!slugs.length) return resultado;

  // Pré-carrega eventos de LP para todos os slugs de uma vez
  const linhasLp = db.prepare(
    `SELECT slug, tipo, COUNT(*) as total FROM lp_eventos
     WHERE slug IN (${slugs.map(() => '?').join(',')}) AND criado_em BETWEEN ? AND ?
     GROUP BY slug, tipo`
  ).all([...slugs, dtInicio, dtFim]);

  const lpPorSlug = {};
  for (const row of linhasLp) {
    if (!lpPorSlug[row.slug]) lpPorSlug[row.slug] = {};
    lpPorSlug[row.slug][row.tipo] = row.total;
  }

  // Nome de cada slug (já vem em C.listar())
  const nomePorSlug = {};
  for (const c of C.listar()) nomePorSlug[c.slug] = c.nome;

  for (const slug of slugs) {
    const lp = {};
    for (const t of TIPOS_LP) lp[t] = (lpPorSlug[slug] || {})[t] || 0;

    const funil = {};
    for (const t of TIPOS_FUNIL) funil[t] = 0;

    let agendamentosConfirmados = 0;
    let agendamentosCancelados = 0;

    const cdb = getClienteDb(slug);
    if (cdb) {
      // Eventos de funil (tabela pode não existir em bancos antigos)
      if (tabelaEventosExiste(cdb)) {
        const linhasFunil = cdb.prepare(
          `SELECT tipo, COUNT(*) as total FROM eventos
           WHERE criado_em BETWEEN ? AND ?
           GROUP BY tipo`
        ).all(dtInicio, dtFim);
        for (const row of linhasFunil) {
          if (TIPOS_FUNIL.includes(row.tipo)) funil[row.tipo] = row.total;
        }
      }

      // Agendamentos por status (ground truth). Filtra por criado_em: dos
      // agendamentos criados no período, quantos estão confirmados / cancelados.
      try {
        const linhasStatus = cdb.prepare(
          `SELECT status, COUNT(*) as total FROM agendamentos
           WHERE criado_em BETWEEN ? AND ?
           GROUP BY status`
        ).all(dtInicio, dtFim);
        for (const row of linhasStatus) {
          if (row.status === 'confirmado') agendamentosConfirmados = row.total;
          else if (row.status === 'cancelado') agendamentosCancelados = row.total;
        }
      } catch (e) {
        // banco antigo sem criado_em — ignora
      }
    }

    resultado[slug] = {
      nome: nomePorSlug[slug] || slug,
      lp,
      funil,
      agendamentosConfirmados,
      agendamentosCancelados,
    };
  }

  return resultado;
}

// ------ Slugs válidos para o coletor público ------
// Previne poluição com slugs inventados.
function slugExiste(slug) {
  return fs.existsSync(path.join(C.PROJETO_RAIZ, 'clientes', slug));
}

module.exports = { inserirLpEvento, getMetricas, slugExiste };
