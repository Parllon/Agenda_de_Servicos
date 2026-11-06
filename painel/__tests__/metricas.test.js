// Agregação (lib/metricas.js): contagem por pessoa, fuso de São Paulo e bloco "site".

const fs = require('fs');
const os = require('os');
const path = require('path');

const RAIZ = fs.mkdtempSync(path.join(os.tmpdir(), 'painel-metricas-'));
process.env.PROJETO_RAIZ = RAIZ;
process.env.METRICAS_DB = ':memory:';
delete process.env.METRICS_SLUGS_EXTRAS;

// Banco de um cliente de mentira, com o mesmo esquema do motor (app/db.js).
const Database = require('better-sqlite3');
const dirBanco = path.join(RAIZ, 'clientes', 'bya', 'banco_dados');
fs.mkdirSync(dirBanco, { recursive: true });
{
  const cdb = new Database(path.join(dirBanco, 'agendamentos.db'));
  cdb.exec(`
    CREATE TABLE eventos (id INTEGER PRIMARY KEY, sessao_id TEXT NOT NULL, tipo TEXT NOT NULL, criado_em TEXT);
    CREATE TABLE agendamentos (id INTEGER PRIMARY KEY, status TEXT, criado_em TEXT);
  `);
  const ev = cdb.prepare('INSERT INTO eventos (sessao_id, tipo, criado_em) VALUES (?, ?, ?)');
  ev.run('s1', 'pagina_vista', '2026-11-10 15:00:00');
  ev.run('s1', 'pagina_vista', '2026-11-10 15:01:00');
  ev.run('s1', 'pagina_vista', '2026-11-10 15:02:00');
  ev.run('s2', 'pagina_vista', '2026-11-10 16:00:00');
  ev.run('s3', 'pagina_vista', '2026-11-11 01:00:00'); // 10/11 22h em SP
  ev.run('s4', 'pagina_vista', '2026-11-10 02:00:00'); // 09/11 23h em SP → fora do dia 10
  const ag = cdb.prepare('INSERT INTO agendamentos (status, criado_em) VALUES (?, ?)');
  ag.run('confirmado', '2026-11-11 01:30:00'); // 10/11 22h30 em SP
  ag.run('confirmado', '2026-11-10 02:30:00'); // 09/11 em SP
  cdb.close();
}

const M = require('../lib/metricas');

const lp = (sessao, tipo, criado_em, utm_source = '') =>
  M.db.prepare('INSERT INTO lp_eventos (slug, sessao_id, tipo, criado_em, utm_source) VALUES (?, ?, ?, ?, ?)')
    .run('slotme_lp', sessao, tipo, criado_em, utm_source);

beforeEach(() => M.db.exec('DELETE FROM lp_eventos'));
afterAll(() => fs.rmSync(RAIZ, { recursive: true, force: true }));

describe('periodoUtc', () => {
  test('dia de São Paulo vira 03:00 → 02:59:59 do dia seguinte em UTC', () => {
    expect(M.periodoUtc('2026-11-10', '2026-11-10')).toEqual({
      dtInicio: '2026-11-10 03:00:00',
      dtFim: '2026-11-11 02:59:59',
    });
  });

  test('padrão = últimos 30 dias até hoje em SP (às 22h de SP ainda é hoje)', () => {
    const agora = new Date('2026-11-11T01:00:00Z'); // 10/11 22h em SP
    expect(M.periodoUtc(undefined, undefined, agora)).toEqual({
      dtInicio: '2026-10-11 03:00:00',
      dtFim: '2026-11-11 02:59:59',
    });
  });

  test('data mal formada cai no padrão', () => {
    const agora = new Date('2026-11-11T01:00:00Z');
    expect(M.periodoUtc("2026-11-10' OR 1=1", 'x', agora)).toEqual(M.periodoUtc(undefined, undefined, agora));
  });
});

describe('contagem distinta (pessoas)', () => {
  test('lp_eventos: 3 eventos da mesma sessão contam 1', () => {
    lp('a', 'lp_vista', '2026-11-10 15:00:00');
    lp('a', 'lp_vista', '2026-11-10 15:01:00');
    lp('a', 'lp_vista', '2026-11-10 15:02:00');
    lp('b', 'lp_vista', '2026-11-10 16:00:00');
    expect(M.getSite('2026-11-10', '2026-11-10').slotme_lp.visitas).toBe(2);
  });

  test('eventos do cliente: COUNT(DISTINCT sessao_id)', () => {
    const r = M.getMetricas(['bya'], '2026-11-10', '2026-11-10');
    // s1 (3x) + s2 + s3 (22h de SP) = 3 pessoas; s4 é do dia 9 em SP
    expect(r.bya.funil.pagina_vista).toBe(3);
  });
});

describe('corte de fuso', () => {
  test('evento das 22h de SP (01h UTC do dia seguinte) fica no dia certo', () => {
    lp('noite', 'lp_vista', '2026-11-11 01:00:00');
    expect(M.getSite('2026-11-10', '2026-11-10').slotme_lp.visitas).toBe(1);
    expect(M.getSite('2026-11-11', '2026-11-11').slotme_lp.visitas).toBe(0);
  });

  test('agendamentos também seguem o dia de SP', () => {
    expect(M.getMetricas(['bya'], '2026-11-10', '2026-11-10').bya.agendamentosConfirmados).toBe(1);
    expect(M.getMetricas(['bya'], '2026-11-09', '2026-11-09').bya.agendamentosConfirmados).toBe(1);
  });
});

describe('bloco site', () => {
  test('funil na ordem das etapas, por pessoa, e separado por utm_source', () => {
    const D = '2026-11-10 15:00:00';
    // pessoa 1: veio do instagram (UTM só no primeiro evento), foi até o fim
    lp('p1', 'lp_vista', D, 'instagram');
    for (const t of M.FUNIL_CADASTRO) lp('p1', t, D);
    lp('p1', 'cad_etapa_voce', D); // repetiu a etapa: continua 1 pessoa
    // pessoa 2: direto, parou na etapa negocio
    lp('p2', 'lp_vista', D);
    lp('p2', 'lp_clicou_whatsapp', D);
    lp('p2', 'cad_vista', D);
    lp('p2', 'cad_etapa_voce', D);
    lp('p2', 'cad_etapa_negocio', D);
    lp('p2', 'cad_erro_envio', D);

    const s = M.getSite('2026-11-10', '2026-11-10').slotme_lp;
    expect(s.visitas).toBe(2);
    expect(s.cliques.lp_clicou_whatsapp).toBe(1);
    expect(s.funil.map((e) => e.tipo)).toEqual([
      'cad_vista', 'cad_etapa_voce', 'cad_etapa_negocio', 'cad_etapa_servicos', 'cad_etapa_equipe',
      'cad_etapa_horarios', 'cad_etapa_visual', 'cad_etapa_revisao', 'cad_enviado',
    ]);
    expect(s.funil.map((e) => e.pessoas)).toEqual([2, 2, 2, 1, 1, 1, 1, 1, 1]);
    expect(s.erros_envio).toBe(1);

    const porOrigem = Object.fromEntries(s.por_origem.map((o) => [o.origem, o]));
    expect(Object.keys(porOrigem).sort()).toEqual(['(direto)', 'instagram']);
    expect(porOrigem.instagram.funil.map((e) => e.pessoas)).toEqual([1, 1, 1, 1, 1, 1, 1, 1, 1]);
    expect(porOrigem['(direto)'].funil.map((e) => e.pessoas)).toEqual([1, 1, 1, 0, 0, 0, 0, 0, 0]);
    expect(porOrigem['(direto)'].erros_envio).toBe(1);
  });
});

describe('série diária e último agendamento', () => {
  test('porDia agrupa por dia de São Paulo (22h30 de SP continua no dia 10)', () => {
    const r = M.getMetricas(['bya'], '2026-11-09', '2026-11-10');
    expect(r.bya.porDia).toEqual({ '2026-11-09': 1, '2026-11-10': 1 });
  });

  test('porDia respeita o período', () => {
    expect(M.getMetricas(['bya'], '2026-11-10', '2026-11-10').bya.porDia).toEqual({ '2026-11-10': 1 });
  });

  test('ultimoAgendamento é o mais recente de todos, em ISO UTC, mesmo fora do período', () => {
    const r = M.getMetricas(['bya'], '2026-10-01', '2026-10-02');
    expect(r.bya.porDia).toEqual({});
    expect(r.bya.ultimoAgendamento).toBe('2026-11-11T01:30:00Z');
  });
});

describe('getSalao (detalhe de um salão)', () => {
  beforeAll(() => {
    const dir = path.join(RAIZ, 'clientes', 'nina', 'banco_dados');
    fs.mkdirSync(dir, { recursive: true });
    const cdb = new Database(path.join(dir, 'agendamentos.db'));
    cdb.exec(`
      CREATE TABLE profissionais (id INTEGER PRIMARY KEY, nome TEXT NOT NULL, calendar_id TEXT);
      CREATE TABLE agendamentos (id INTEGER PRIMARY KEY, profissional_id INTEGER, servico_nome TEXT,
        inicio TEXT, fim TEXT, status TEXT, criado_em TEXT);
    `);
    cdb.prepare("INSERT INTO profissionais (id, nome) VALUES (1, 'Ana'), (2, 'Bia')").run();
    const ag = cdb.prepare('INSERT INTO agendamentos (profissional_id, servico_nome, inicio, fim, status, criado_em) VALUES (?, ?, ?, ?, ?, ?)');
    // sábado 14/11, 9h e 10h em SP (12h/13h UTC)
    ag.run(1, 'Manicure', '2026-11-14T12:00:00.000Z', '2026-11-14T13:00:00.000Z', 'confirmado', '2026-11-10 15:00:00');
    ag.run(1, 'Manicure', '2026-11-14T13:00:00.000Z', '2026-11-14T14:00:00.000Z', 'cancelado', '2026-11-10 15:05:00');
    // terça 10/11, 17h em SP
    ag.run(2, 'Pedicure', '2026-11-10T20:00:00.000Z', '2026-11-10T21:30:00.000Z', 'confirmado', '2026-11-10 12:00:00');
    // criado fora do período (antes): não conta em serviços/profissionais
    ag.run(2, 'Pedicure', '2026-11-11T12:00:00.000Z', '2026-11-11T13:00:00.000Z', 'confirmado', '2026-11-01 12:00:00');
    cdb.close();
  });

  const cfg = { expedienteInicio: 9, expedienteFim: 19, folgas: [0] };
  const r = () => M.getSalao('nina', '2026-11-10', '2026-11-16', cfg);

  test('serviços mais agendados no período (qualquer status)', () => {
    expect(r().servicos).toEqual([{ nome: 'Manicure', total: 2 }, { nome: 'Pedicure', total: 1 }]);
  });

  test('por profissional: total, cancelados e ocupação pela data do atendimento', () => {
    const [ana, bia] = r().profissionais;
    expect(ana).toMatchObject({ nome: 'Ana', total: 2, cancelados: 1, minutos: 60 });
    // 7 dias menos o domingo = 6 dias × 10h = 3600 min; Bia: 90 (criado no período) + 60 (criado antes, atendido no período)
    expect(bia).toMatchObject({ nome: 'Bia', total: 1, cancelados: 0, minutos: 150 });
    expect(ana.ocupacao).toBeCloseTo(60 / 3600);
  });

  test('mapa de calor: faixas de 2h, sem o dia de folga, mínimo de 30 dias', () => {
    const c = r().calor;
    expect(c.faixas).toEqual([9, 11, 13, 15, 17]);
    expect(c.dias.map((d) => d.dia)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(c.inicio).toBe('2026-10-18');
    expect(c.dias.find((d) => d.dia === 6).valores).toEqual([2, 0, 0, 0, 0]);
    expect(c.dias.find((d) => d.dia === 2).valores).toEqual([0, 0, 0, 0, 1]);
    expect(c.dias.find((d) => d.dia === 3).valores).toEqual([1, 0, 0, 0, 0]); // o criado em 01/11 entra no calor
  });

  test('salão sem banco devolve listas vazias', () => {
    const x = M.getSalao('naoexiste', '2026-11-10', '2026-11-16', cfg);
    expect(x.servicos).toEqual([]);
    expect(x.calor).toBeNull();
  });
});
