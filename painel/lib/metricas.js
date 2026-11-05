// metricas.js — banco central de eventos de landing page + agregação do funil.
// Landing page events -> metricas.db (lp_eventos)
// Scheduling funnel events -> cada cliente/*/banco_dados/agendamentos.db (eventos)
// O painel lê os bancos dos clientes em modo READ-ONLY (não escreve neles).
//
// Contagens são de PESSOAS (COUNT DISTINCT sessao_id), não de cliques: quem
// recarrega a página 5 vezes conta 1 visita.
//
// Fuso: criado_em é gravado em UTC (datetime('now') do SQLite). O filtro do
// período chega em datas de São Paulo e é convertido para UTC (ver periodoUtc).

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const C = require('./clientes');

// METRICAS_DB permite apontar para outro arquivo (ou ":memory:" nos testes).
const DB_PATH = process.env.METRICAS_DB || path.join(C.PROJETO_RAIZ, 'painel', 'metricas.db');

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

// Migração segura: colunas de origem (UTM) só são criadas se ainda não existirem.
// Linhas antigas ficam com '' (sem origem).
const COLUNAS_UTM = ['utm_source', 'utm_medium', 'utm_campaign'];
{
  const existentes = new Set(db.prepare('PRAGMA table_info(lp_eventos)').all().map((c) => c.name));
  for (const col of COLUNAS_UTM) {
    if (!existentes.has(col)) db.exec(`ALTER TABLE lp_eventos ADD COLUMN ${col} TEXT NOT NULL DEFAULT ''`);
  }
}

// ------ Tipos aceitos (lista FECHADA — nada de padrão aberto) ------
const TIPOS_LP = ['lp_vista', 'lp_clicou_agendar', 'lp_clicou_whatsapp', 'lp_clicou_cliente', 'lp_enviou_formulario'];
// Etapas do cadastro do site, na ordem em que aparecem (Site_agendamentos/src/components/cadastro).
const ETAPAS_CADASTRO = ['voce', 'negocio', 'servicos', 'equipe', 'horarios', 'visual', 'revisao'];
const FUNIL_CADASTRO = ['cad_vista', ...ETAPAS_CADASTRO.map((id) => `cad_etapa_${id}`), 'cad_enviado'];
const TIPOS_EVENTO = new Set([...TIPOS_LP, ...FUNIL_CADASTRO, 'cad_erro_envio']);
const CLIQUES = TIPOS_LP.filter((t) => t !== 'lp_vista');

const TIPOS_FUNIL = [
  'pagina_vista', 'profissional_selecionado', 'servico_selecionado',
  'horario_selecionado', 'dados_preenchidos', 'agendamento_criado',
];

// ------ Slugs ------
// Extras = sites que não são pasta de cliente (ex.: a landing do próprio SlotMe).
function slugsExtras() {
  return (process.env.METRICS_SLUGS_EXTRAS ?? 'slotme_lp')
    .split(',').map((s) => s.trim()).filter(Boolean);
}

const SLUG_OK = /^[a-z0-9_-]{1,40}$/;

// Previne poluição com slugs inventados (e "../" no caminho).
function slugValido(slug) {
  if (typeof slug !== 'string' || !SLUG_OK.test(slug) || slug === '_template') return false;
  if (slugsExtras().includes(slug)) return true;
  return fs.existsSync(path.join(C.PROJETO_RAIZ, 'clientes', slug));
}

// ------ UTM ------
// Só [a-z0-9._-], até 60 caracteres, em minúsculas. Qualquer outra coisa vira ''.
function limparUtm(v) {
  if (typeof v !== 'string') return '';
  const t = v.trim().toLowerCase();
  return /^[a-z0-9._-]{1,60}$/.test(t) ? t : '';
}

// ------ Fuso ------
// São Paulo = UTC-3 fixo (sem horário de verão desde 2019).
const OFFSET_SP_H = 3;
const DATA = /^\d{4}-\d{2}-\d{2}$/;
const diaSP = (d) => new Date(d.getTime() - OFFSET_SP_H * 3600000).toISOString().slice(0, 10);
const sqlUtc = (ms) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');

function msInicioDiaSP(data) {
  const [a, m, d] = data.split('-').map(Number);
  return Date.UTC(a, m - 1, d, OFFSET_SP_H, 0, 0);
}

// 'YYYY-MM-DD' (dias de São Paulo) -> { dtInicio, dtFim } em UTC no formato do SQLite.
// Ex.: dia 10 em SP = 10 03:00:00 .. 11 02:59:59 UTC (o evento das 22h do dia 10
// é gravado como 01h do dia 11 UTC e continua contando no dia 10).
function periodoUtc(inicio, fim, agora = new Date()) {
  const fimDia = DATA.test(fim || '') ? fim : diaSP(agora);
  const iniDia = DATA.test(inicio || '') ? inicio : diaSP(new Date(msInicioDiaSP(fimDia) - 30 * 86400000));
  return {
    dtInicio: sqlUtc(msInicioDiaSP(iniDia)),
    dtFim: sqlUtc(msInicioDiaSP(fimDia) + 86400000 - 1000),
  };
}

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
function inserirLpEvento(slug, sessaoId, tipo, utm = {}) {
  db.prepare(
    'INSERT INTO lp_eventos (slug, sessao_id, tipo, utm_source, utm_medium, utm_campaign) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(slug, sessaoId, tipo, limparUtm(utm.utm_source), limparUtm(utm.utm_medium), limparUtm(utm.utm_campaign));
}

// ------ Aggregation (clientes) ------
// Retorna um objeto por slug com PESSOAS por tipo de evento + agendamentos.
// periodo: inicio/fim 'YYYY-MM-DD' em dias de São Paulo — padrão: últimos 30 dias.
function getMetricas(slugs, inicio, fim) {
  const { dtInicio, dtFim } = periodoUtc(inicio, fim);
  const resultado = {};
  if (!slugs.length) return resultado;

  // Pré-carrega eventos de LP para todos os slugs de uma vez
  const linhasLp = db.prepare(
    `SELECT slug, tipo, COUNT(DISTINCT sessao_id) as total FROM lp_eventos
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
          `SELECT tipo, COUNT(DISTINCT sessao_id) as total FROM eventos
           WHERE criado_em BETWEEN ? AND ?
           GROUP BY tipo`
        ).all(dtInicio, dtFim);
        for (const row of linhasFunil) {
          if (TIPOS_FUNIL.includes(row.tipo)) funil[row.tipo] = row.total;
        }
      }

      // Agendamentos por status (ground truth). Aqui cada linha É um agendamento,
      // então continua COUNT(*). Dos criados no período, quantos estão
      // confirmados / cancelados.
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

// ------ Aggregation (sites extras, ex.: slotme_lp) ------
// Por slug: visitas, cliques, funil do cadastro (pessoas distintas por etapa) e o
// mesmo funil por utm_source. A origem é da PESSOA: se qualquer evento da sessão
// trouxe utm_source, a sessão inteira conta para essa origem ('' = "(direto)").
function getSite(inicio, fim) {
  const { dtInicio, dtFim } = periodoUtc(inicio, fim);
  const porTipo = db.prepare(
    `SELECT tipo, COUNT(DISTINCT sessao_id) AS pessoas FROM lp_eventos
     WHERE slug = ? AND criado_em BETWEEN ? AND ? GROUP BY tipo`
  );
  const porOrigem = db.prepare(
    `WITH ev AS (
       SELECT sessao_id, tipo, utm_source FROM lp_eventos
       WHERE slug = ? AND criado_em BETWEEN ? AND ?
     ), origem AS (
       SELECT sessao_id, MAX(utm_source) AS src FROM ev GROUP BY sessao_id
     )
     SELECT o.src AS origem, ev.tipo, COUNT(DISTINCT ev.sessao_id) AS pessoas
     FROM ev JOIN origem o USING (sessao_id)
     GROUP BY o.src, ev.tipo`
  );

  const site = {};
  for (const slug of slugsExtras()) {
    const tipos = {};
    for (const r of porTipo.all(slug, dtInicio, dtFim)) tipos[r.tipo] = r.pessoas;

    const origens = {};
    for (const r of porOrigem.all(slug, dtInicio, dtFim)) {
      const o = r.origem || '(direto)';
      (origens[o] = origens[o] || {})[r.tipo] = r.pessoas;
    }

    const montarFunil = (t) => FUNIL_CADASTRO.map((tipo) => ({ tipo, pessoas: t[tipo] || 0 }));
    site[slug] = {
      visitas: tipos.lp_vista || 0,
      cliques: Object.fromEntries(CLIQUES.map((t) => [t, tipos[t] || 0])),
      funil: montarFunil(tipos),
      erros_envio: tipos.cad_erro_envio || 0,
      por_origem: Object.entries(origens)
        .map(([origem, t]) => ({
          origem,
          visitas: t.lp_vista || 0,
          funil: montarFunil(t),
          erros_envio: t.cad_erro_envio || 0,
        }))
        .sort((a, b) => b.visitas - a.visitas || a.origem.localeCompare(b.origem)),
    };
  }
  return site;
}

module.exports = {
  inserirLpEvento, getMetricas, getSite, slugValido, slugsExtras, limparUtm, periodoUtc,
  TIPOS_EVENTO, FUNIL_CADASTRO, db,
};
