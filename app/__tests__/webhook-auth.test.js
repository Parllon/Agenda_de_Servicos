// webhook-auth.test.js — só quem tem o WEBHOOK_TOKEN aciona o webhook.

const request = require('supertest');

jest.mock('../google', () => ({ getCalendarClient: jest.fn() }));
jest.mock('../whatsapp', () => ({
  enviarWhatsapp: jest.fn().mockResolvedValue({}),
  modoWhatsapp: 'proprio',
}));
jest.mock('../telegram', () => ({
  notificar: jest.fn(),
  montarAviso: jest.fn().mockReturnValue(''),
  htmlParaWhatsapp: jest.fn((t) => t),
}));

const { getCalendarClient } = require('../google');
const { enviarWhatsapp } = require('../whatsapp');
const app = require('../server');

const TOKEN = 'token-de-teste'; // o mesmo de setup.js
// "3" de um número sem agendamento: se passar pela trava, o salão responde "Não encontrei".
const MSG = { event: 'message', payload: { from: '5521900000000@c.us', body: '3', fromMe: false } };
const esperar = () => new Promise((r) => setTimeout(r, 50));

afterEach(() => jest.clearAllMocks());

async function chamar(alvo, { url = '/webhook-whatsapp', cabecalho } = {}) {
  const req = request(alvo).post(url);
  if (cabecalho !== undefined) req.set('X-Webhook-Token', cabecalho);
  const res = await req.send(MSG);
  await esperar();
  return res;
}

function nadaAconteceu() {
  expect(getCalendarClient).not.toHaveBeenCalled();
  expect(enviarWhatsapp).not.toHaveBeenCalled();
}

describe('recusa', () => {
  test.each([
    ['sem token', {}],
    ['token errado', { cabecalho: 'token-de-testX' }],
    ['token de tamanho diferente', { cabecalho: 'abc' }],
    ['?token= errado', { url: '/webhook-whatsapp?token=abc' }],
  ])('%s → 403 e nada acontece', async (_, opcoes) => {
    expect((await chamar(app, opcoes)).status).toBe(403);
    nadaAconteceu();
  });

  test('salão sem WEBHOOK_TOKEN configurado recusa tudo', async () => {
    const guardado = process.env.WEBHOOK_TOKEN;
    delete process.env.WEBHOOK_TOKEN;
    let semToken;
    jest.isolateModules(() => { semToken = require('../server'); });
    process.env.WEBHOOK_TOKEN = guardado;

    expect((await chamar(semToken)).status).toBe(403);
    expect((await chamar(semToken, { cabecalho: '' })).status).toBe(403);
    nadaAconteceu();
  });
});

describe('aceita', () => {
  test.each([
    ['cabeçalho X-Webhook-Token', { cabecalho: TOKEN }],
    ['?token=', { url: `/webhook-whatsapp?token=${TOKEN}` }],
  ])('%s correto → 200 e processa', async (_, opcoes) => {
    expect((await chamar(app, opcoes)).status).toBe(200);
    expect(enviarWhatsapp).toHaveBeenCalledTimes(1);
  });
});
