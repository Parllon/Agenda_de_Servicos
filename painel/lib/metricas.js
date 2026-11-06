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
function limitesSP(inicio, fim, agora = new Date()) {
  const fimDia = DATA.test(fim || '') ? fim : diaSP(agora);
  const iniDia = DATA.test(inicio || '') ? inicio : diaSP(new Date(msInicioDiaSP(fimDia) - 30 * 86400000));
  return { iniDia, fimDia };
}

function periodoUtc(inicio, fim, agora = new Date()) {
  const { iniDia, fimDia } = limitesSP(inicio, fim, agora);
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
    const porDia = {}; // 'YYYY-MM-DD' (dia de São Paulo) -> agendamentos criados
    let ultimoAgendamento = null; // ISO UTC do mais recente (qualquer data, não só o período)

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

      // Série diária (gráfico "Agendamentos por dia") e último agendamento (alerta
      // de salão parado). criado_em é UTC; o dia é convertido para São Paulo.
      try {
        const linhasDia = cdb.prepare(
          `SELECT date(criado_em, '-${OFFSET_SP_H} hours') AS dia, COUNT(*) AS total FROM agendamentos
           WHERE criado_em BETWEEN ? AND ?
           GROUP BY dia`
        ).all(dtInicio, dtFim);
        for (const row of linhasDia) if (row.dia) porDia[row.dia] = row.total;
        const u = cdb.prepare('SELECT MAX(criado_em) AS ultimo FROM agendamentos').get();
        if (u && u.ultimo) ultimoAgendamento = `${u.ultimo.replace(' ', 'T')}Z`;
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
      porDia,
      ultimoAgendamento,
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

// ------ Detalhe de UM salão ------
// Além do que getMetricas já traz: serviços mais agendados, números por
// profissional (com ocupação aproximada) e o mapa de calor dia da semana × faixa
// de horário. `cfg` vem do .env do cliente: { expedienteInicio, expedienteFim, folgas: [0..6] }.
//
// - Serviços / profissionais / calor contam agendamentos CRIADOS no período
//   (procura), qualquer status. O calor usa no mínimo 30 dias para ter volume.
// - Ocupação usa a DATA DO ATENDIMENTO (inicio) dentro do período, só confirmados:
//   minutos agendados ÷ minutos de expediente nos dias abertos. É aproximada: não
//   desconta pausas nem horários diferentes por profissional.
const DIA_MS = 86400000;
const OFFSET_MS = OFFSET_SP_H * 3600000;

function getSalao(slug, inicio, fim, cfg = {}, agora = new Date()) {
  const { iniDia, fimDia } = limitesSP(inicio, fim, agora);
  const base = getMetricas([slug], iniDia, fimDia)[slug];
  const ini = Number.isInteger(cfg.expedienteInicio) ? cfg.expedienteInicio : 9;
  const fimH = Number.isInteger(cfg.expedienteFim) && cfg.expedienteFim > ini ? cfg.expedienteFim : 19;
  const folgas = new Set(Array.isArray(cfg.folgas) ? cfg.folgas : []);
  const r = { ...base, periodo: { inicio: iniDia, fim: fimDia }, servicos: [], profissionais: [], calor: null };
  const cdb = getClienteDb(slug);
  if (!cdb) return r;

  let profs = [];
  try { profs = cdb.prepare('SELECT id, nome FROM profissionais ORDER BY id').all(); } catch (e) { /* banco antigo */ }

  let linhas = [];
  let linhasCalor = [];
  let linhasOcup = [];
  const calorIni = msInicioDiaSP(iniDia) > msInicioDiaSP(fimDia) - 29 * DIA_MS
    ? diaSP(new Date(msInicioDiaSP(fimDia) - 29 * DIA_MS + OFFSET_MS)) : iniDia;
  try {
    const sel = cdb.prepare(
      `SELECT inicio, fim, status, servico_nome, profissional_id FROM agendamentos
       WHERE criado_em BETWEEN ? AND ?`
    );
    const p = periodoUtc(iniDia, fimDia);
    linhas = sel.all(p.dtInicio, p.dtFim);
    const pc = periodoUtc(calorIni, fimDia);
    linhasCalor = sel.all(pc.dtInicio, pc.dtFim);
    // atendimentos dentro do período podem ter sido marcados até ~4 meses antes
    linhasOcup = cdb.prepare(
      `SELECT inicio, fim, profissional_id FROM agendamentos
       WHERE status = 'confirmado' AND criado_em >= ?`
    ).all(sqlUtc(msInicioDiaSP(iniDia) - 120 * DIA_MS));
  } catch (e) {
    return r; // banco antigo sem as colunas
  }

  // Serviços
  const porServico = new Map();
  for (const l of linhas) {
    const nome = (l.servico_nome || '').trim() || '(sem nome)';
    porServico.set(nome, (porServico.get(nome) || 0) + 1);
  }
  r.servicos = [...porServico].map(([nome, total]) => ({ nome, total }))
    .sort((a, b) => b.total - a.total || a.nome.localeCompare(b.nome)).slice(0, 8);

  // Dias abertos no período (para a ocupação)
  let diasAbertos = 0;
  for (let ms = msInicioDiaSP(iniDia); ms <= msInicioDiaSP(fimDia); ms += DIA_MS) {
    if (!folgas.has(new Date(ms).getUTCDay())) diasAbertos++;
  }
  const minutosAbertos = diasAbertos * (fimH - ini) * 60;
  const msIni = msInicioDiaSP(iniDia);
  const msFim = msInicioDiaSP(fimDia) + DIA_MS;

  const porProf = new Map(profs.map((p) => [p.id, { id: p.id, nome: p.nome, total: 0, cancelados: 0, minutos: 0 }]));
  const prof = (id) => {
    if (!porProf.has(id)) porProf.set(id, { id, nome: `Profissional ${id ?? '?'}`, total: 0, cancelados: 0, minutos: 0 });
    return porProf.get(id);
  };
  for (const l of linhas) {
    const p = prof(l.profissional_id);
    p.total++;
    if (l.status === 'cancelado') p.cancelados++;
  }
  for (const l of linhasOcup) {
    const a = Date.parse(l.inicio), b = Date.parse(l.fim);
    if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a || a < msIni || a >= msFim) continue;
    prof(l.profissional_id).minutos += Math.round((b - a) / 60000);
  }
  r.profissionais = [...porProf.values()].map((p) => ({
    ...p,
    ocupacao: minutosAbertos ? Math.min(1, p.minutos / minutosAbertos) : null,
  })).sort((a, b) => b.total - a.total || a.nome.localeCompare(b.nome));

  // Mapa de calor: linhas = dias abertos (seg..dom), colunas = faixas de 2h do expediente
  const faixas = [];
  for (let h = ini; h < fimH; h += 2) faixas.push(h);
  const ordem = [1, 2, 3, 4, 5, 6, 0].filter((d) => !folgas.has(d));
  const grade = Object.fromEntries(ordem.map((d) => [d, faixas.map(() => 0)]));
  for (const l of linhasCalor) {
    const a = Date.parse(l.inicio);
    if (!Number.isFinite(a)) continue;
    const sp = new Date(a - OFFSET_MS);
    const d = sp.getUTCDay(), h = sp.getUTCHours();
    if (!grade[d]) continue;
    const i = faixas.findIndex((f) => h >= f && h < f + 2);
    if (i >= 0) grade[d][i]++;
  }
  r.calor = { inicio: calorIni, fim: fimDia, faixas, dias: ordem.map((d) => ({ dia: d, valores: grade[d] })) };
  return r;
}

module.exports = {
  inserirLpEvento, getMetricas, getSite, getSalao, slugValido, slugsExtras, limparUtm, periodoUtc,
  TIPOS_EVENTO, FUNIL_CADASTRO, db,
};
