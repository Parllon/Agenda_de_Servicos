// agenda-ics.test.js — agenda por assinatura (.ics), página /assinar e boas-vindas ao dono.

process.env.AGENDA_ICS_SEGREDO = 'segredo-de-teste';
process.env.CADASTRO_PROTOCOLO = 'SLT-ABC234';

const request = require('supertest');

jest.mock('../google', () => ({ getCalendarClient: jest.fn() }));
jest.mock('../whatsapp', () => ({
  enviarWhatsapp: jest.fn().mockResolvedValue({}),
  modoWhatsapp: 'central',
}));
jest.mock('../telegram', () => ({
  notificar: jest.fn(),
  montarAviso: jest.fn().mockReturnValue(''),
  htmlParaWhatsapp: jest.fn((t) => t),
}));

const { getCalendarClient } = require('../google');
const { enviarWhatsapp } = require('../whatsapp');
const ics = require('../agenda-ics');
const app = require('../server');
const db = require('../db');

const SEGREDO = 'segredo-de-teste';

beforeAll(() => {
  db.exec('DELETE FROM profissionais');
  db.prepare('INSERT INTO profissionais (id, nome, calendar_id) VALUES (?, ?, ?)').run(1, 'Bia', 'cal-bia');
  db.prepare('INSERT INTO profissionais (id, nome, calendar_id) VALUES (?, ?, ?)').run(2, 'Carla', 'cal-carla');
});

beforeEach(() => {
  ics.limparCache();
  enviarWhatsapp.mockClear();
  const porAgenda = {
    'cal-bia': [{ id: 'e1', summary: 'Corte — Ana', description: 'Tel: 5521999998888\nValor: R$ 50,00',
      start: { dateTime: '2026-12-01T10:00:00-03:00' }, end: { dateTime: '2026-12-01T11:00:00-03:00' } }],
    'cal-carla': [{ id: 'e2', summary: 'Folga', start: { date: '2026-12-02' }, end: { date: '2026-12-03' } },
      { id: 'e3', status: 'cancelled', summary: 'x', start: { dateTime: '2026-12-02T10:00:00-03:00' }, end: { dateTime: '2026-12-02T11:00:00-03:00' } }],
  };
  getCalendarClient.mockReturnValue({
    events: { list: jest.fn(async ({ calendarId }) => ({ data: { items: porAgenda[calendarId] || [] } })) },
  });
});

describe('tokens', () => {
  test('dono e profissionais têm tokens diferentes e resolvíveis', () => {
    const tDono = ics.tokenDe(SEGREDO, 'todos');
    const tBia = ics.tokenDe(SEGREDO, 'prof:1');
    expect(tDono).toMatch(/^[0-9a-f]{32}$/);
    expect(tDono).not.toBe(tBia);
    expect(ics.resolverToken(SEGREDO, tDono, [1, 2])).toEqual({ alvo: 'todos' });
    expect(ics.resolverToken(SEGREDO, tBia, [1, 2])).toEqual({ alvo: 'prof', id: 1 });
    expect(ics.resolverToken(SEGREDO, 'f'.repeat(32), [1, 2])).toBeNull();
    expect(ics.resolverToken('', tDono, [1, 2])).toBeNull();
  });
});

describe('formato iCalendar', () => {
  test('escapa caracteres especiais e dobra linhas em 75 bytes sem quebrar acentos', () => {
    expect(ics.escapar('a,b;c\\d\ne')).toBe('a\\,b\\;c\\\\d\\ne');
    const longa = `SUMMARY:${'ção'.repeat(40)}`;
    const dobrada = ics.dobrar(longa);
    for (const linha of dobrada.split('\r\n')) expect(Buffer.byteLength(linha)).toBeLessThanOrEqual(75);
    expect(dobrada.split('\r\n').map((l, i) => (i ? l.slice(1) : l)).join('')).toBe(longa);
  });
});

describe('GET /agenda/:token.ics', () => {
  test('dono vê as agendas de todos, com nome do profissional, em UTC', async () => {
    const res = await request(app).get(`/agenda/${ics.tokenDe(SEGREDO, 'todos')}.ics`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/calendar/);
    expect(res.text).toMatch(/^BEGIN:VCALENDAR\r\n/);
    expect(res.text).toContain('SUMMARY:[Bia] Corte — Ana');
    expect(res.text).toContain('DTSTART:20261201T130000Z');
    expect(res.text).toContain('DTSTART;VALUE=DATE:20261202');
    expect(res.text).toContain('DESCRIPTION:Tel: 5521999998888\\nValor: R$ 50\\,00');
    expect(res.text).not.toContain('UID:e3@'); // cancelado não aparece
    expect(res.text.trimEnd().endsWith('END:VCALENDAR')).toBe(true);
  });

  test('profissional vê só a própria agenda (sem prefixo de nome)', async () => {
    const res = await request(app).get(`/agenda/${ics.tokenDe(SEGREDO, 'prof:1')}.ics`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('SUMMARY:Corte — Ana');
    expect(res.text).not.toContain('Folga');
  });

  test('token errado → 404', async () => {
    const res = await request(app).get(`/agenda/${'a'.repeat(32)}.ics`);
    expect(res.status).toBe(404);
  });

  test('Google fora do ar → 503 (não 500)', async () => {
    getCalendarClient.mockReturnValue({ events: { list: jest.fn().mockRejectedValue(new Error('boom')) } });
    const res = await request(app).get(`/agenda/${ics.tokenDe(SEGREDO, 'todos')}.ics`);
    expect(res.status).toBe(503);
  });
});

describe('GET /assinar/:token', () => {
  test('página com o link webcal e botão do Google', async () => {
    const t = ics.tokenDe(SEGREDO, 'todos');
    const res = await request(app).get(`/assinar/${t}`);
    expect(res.status).toBe(200);
    expect(res.text).toContain(`webcal://`);
    expect(res.text).toContain(`/agenda/${t}.ics`);
    expect(res.text).toContain('calendar.google.com/calendar/r?cid=');
  });
  test('token errado → 404', async () => {
    expect((await request(app).get(`/assinar/${'b'.repeat(32)}`)).status).toBe(404);
  });
});

describe('boas-vindas ao dono (webhook)', () => {
  const msg = (from, body) => ({ event: 'message', payload: { from: `${from}@c.us`, body, fromMe: false } });
  const esperar = () => new Promise((r) => setTimeout(r, 50));

  test('mensagem com o protocolo do cadastro → responde com os links', async () => {
    await request(app).post('/webhook-whatsapp').send(msg('5521911112222', 'Oi! Quero ativar os avisos do meu salão (SLT-ABC234).'));
    await esperar();
    expect(enviarWhatsapp).toHaveBeenCalledTimes(1);
    const [numero, texto] = enviarWhatsapp.mock.calls[0];
    expect(numero).toBe('5521911112222');
    expect(texto).toContain(`/assinar/${ics.tokenDe(SEGREDO, 'todos')}`);
  });

  test('protocolo de OUTRO salão → silêncio (outro container responde)', async () => {
    await request(app).post('/webhook-whatsapp').send(msg('5521911112222', 'Oi! Quero ativar os avisos do meu salão (SLT-ZZZZZZ).'));
    await esperar();
    expect(enviarWhatsapp).not.toHaveBeenCalled();
  });
});
