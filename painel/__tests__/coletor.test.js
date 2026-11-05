// Coletor público POST /api/evento (lib/coletor.js).

const fs = require('fs');
const os = require('os');
const path = require('path');

const RAIZ = fs.mkdtempSync(path.join(os.tmpdir(), 'painel-coletor-'));
fs.mkdirSync(path.join(RAIZ, 'clientes', 'bya'), { recursive: true });
fs.mkdirSync(path.join(RAIZ, 'clientes', '_template'), { recursive: true });
process.env.PROJETO_RAIZ = RAIZ;
process.env.METRICAS_DB = ':memory:';
delete process.env.METRICS_SLUGS_EXTRAS; // padrão: slotme_lp

const express = require('express');
const request = require('supertest');
const M = require('../lib/metricas');
const { criarColetor } = require('../lib/coletor');

const TOKEN = 'tok-teste';
const app = express();
app.use(express.json({ limit: '1mb' })); // como o server.js (parser global antes do coletor)
app.use(criarColetor({ token: TOKEN }));

const ultimo = () => M.db.prepare('SELECT * FROM lp_eventos ORDER BY id DESC LIMIT 1').get();
const total = () => M.db.prepare('SELECT COUNT(*) AS n FROM lp_eventos').get().n;
const evento = (extra = {}) => ({ slug: 'slotme_lp', sessaoId: 'sess-1', tipo: 'lp_vista', _token: TOKEN, ...extra });

beforeEach(() => M.db.exec('DELETE FROM lp_eventos'));
afterAll(() => fs.rmSync(RAIZ, { recursive: true, force: true }));

describe('tipos', () => {
  test('tipo fora da lista é recusado', async () => {
    await request(app).post('/api/evento').send(evento({ tipo: 'qualquer_coisa' })).expect(400);
    await request(app).post('/api/evento').send(evento({ tipo: 'cad_etapa_inventada' })).expect(400);
    expect(total()).toBe(0);
  });

  test.each(['lp_clicou_cliente', 'lp_enviou_formulario', 'cad_vista', 'cad_enviado', 'cad_erro_envio', 'cad_etapa_voce', 'cad_etapa_revisao'])(
    'tipo novo %s é aceito', async (tipo) => {
      await request(app).post('/api/evento').send(evento({ tipo })).expect(200);
      expect(ultimo().tipo).toBe(tipo);
    },
  );
});

describe('slugs', () => {
  test('slug extra (slotme_lp, padrão de METRICS_SLUGS_EXTRAS) é aceito', async () => {
    await request(app).post('/api/evento').send(evento()).expect(200);
    expect(ultimo().slug).toBe('slotme_lp');
  });

  test('pasta de cliente é aceita', async () => {
    await request(app).post('/api/evento').send(evento({ slug: 'bya' })).expect(200);
  });

  test.each(['inventado', '_template', '../clientes/bya', 'BYA'])('slug %s é recusado', async (slug) => {
    await request(app).post('/api/evento').send(evento({ slug })).expect(400);
    expect(total()).toBe(0);
  });

  test('METRICS_SLUGS_EXTRAS troca a lista', async () => {
    process.env.METRICS_SLUGS_EXTRAS = 'outro_site';
    try {
      await request(app).post('/api/evento').send(evento({ slug: 'outro_site' })).expect(200);
      await request(app).post('/api/evento').send(evento()).expect(400);
    } finally {
      delete process.env.METRICS_SLUGS_EXTRAS;
    }
  });
});

describe('corpo e token', () => {
  test('text/plain com JSON é aceito (sem preflight)', async () => {
    await request(app).post('/api/evento')
      .set('Content-Type', 'text/plain;charset=UTF-8')
      .send(JSON.stringify(evento({ tipo: 'cad_vista' })))
      .expect(200);
    expect(ultimo().tipo).toBe('cad_vista');
  });

  test('text/plain que não é JSON → 400', async () => {
    await request(app).post('/api/evento').set('Content-Type', 'text/plain').send('oi').expect(400);
  });

  test('text/plain acima de 2 KB → 413', async () => {
    const grande = JSON.stringify(evento({ lixo: 'x'.repeat(3000) }));
    await request(app).post('/api/evento').set('Content-Type', 'text/plain').send(grande).expect(413);
    expect(total()).toBe(0);
  });

  test('token pelo cabeçalho X-Metrics-Token', async () => {
    const { _token, ...semToken } = evento();
    await request(app).post('/api/evento').set('X-Metrics-Token', TOKEN).send(semToken).expect(200);
  });

  test('sem token ou token errado → 403', async () => {
    const { _token, ...semToken } = evento();
    await request(app).post('/api/evento').send(semToken).expect(403);
    await request(app).post('/api/evento').send(evento({ _token: 'errado' })).expect(403);
  });

  test('sessaoId estranho → 400', async () => {
    await request(app).post('/api/evento').send(evento({ sessaoId: 'a b<script>' })).expect(400);
  });

  test('OPTIONS (preflight dos sites que mandam JSON) responde com CORS', async () => {
    const r = await request(app).options('/api/evento')
      .set('Origin', 'https://exemplo.agendamentos.app.br')
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'content-type,x-metrics-token')
      .expect(204);
    expect(r.headers['access-control-allow-origin']).toBe('*');
    expect(r.headers['access-control-allow-methods']).toMatch(/POST/);
    expect(r.headers['access-control-allow-headers'].toLowerCase()).toMatch(/x-metrics-token/);
  });
});

describe('UTM', () => {
  test('UTM válida é gravada em minúsculas', async () => {
    await request(app).post('/api/evento')
      .send(evento({ utm_source: 'Instagram', utm_medium: 'cpc', utm_campaign: 'black-friday_2026.v2' }))
      .expect(200);
    expect(ultimo()).toMatchObject({ utm_source: 'instagram', utm_medium: 'cpc', utm_campaign: 'black-friday_2026.v2' });
  });

  test('UTM inválida é descartada (vira vazio), o evento continua valendo', async () => {
    await request(app).post('/api/evento')
      .send(evento({ utm_source: 'insta gram', utm_medium: '<b>', utm_campaign: 'x'.repeat(61) }))
      .expect(200);
    expect(ultimo()).toMatchObject({ utm_source: '', utm_medium: '', utm_campaign: '' });
  });

  test('UTM que não é texto vira vazio', async () => {
    await request(app).post('/api/evento').send(evento({ utm_source: { $gt: '' } })).expect(200);
    expect(ultimo().utm_source).toBe('');
  });
});
