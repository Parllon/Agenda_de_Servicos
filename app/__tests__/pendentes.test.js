// pendentes.test.js — horários pendentes, lista de resposta ambígua e trava no salão.

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
const { notificar } = require('../telegram');
const { montarAvisoAmbiguo } = require('../pendentes');
const app = require('../server');
const db = require('../db');

const TELEFONE = '5521999998888';
const FROM = `${TELEFONE}@c.us`;
const HORA = 3600000;
const DIA = 24 * HORA;
const daqui = (ms) => new Date(Date.now() + ms).toISOString();
const esperar = () => new Promise((r) => setTimeout(r, 50));

let calendar;

beforeAll(() => {
  db.prepare(
    "INSERT OR REPLACE INTO profissionais (id, nome, calendar_id) VALUES (1, 'Profissional Teste', 'test@gmail.com')"
  ).run();
});

beforeEach(() => {
  calendar = { events: { delete: jest.fn().mockResolvedValue({}) } };
  getCalendarClient.mockReturnValue(calendar);
});

afterEach(() => {
  db.prepare('DELETE FROM agendamentos').run();
  jest.clearAllMocks();
  jest.restoreAllMocks();
});

function criar(servico, ms, { status = 'confirmado', telefone = TELEFONE } = {}) {
  const inicio = daqui(ms);
  db.prepare(
    `INSERT INTO agendamentos
       (google_event_id, profissional_id, servico_nome, cliente_nome, cliente_telefone, inicio, fim, status)
     VALUES (?, 1, ?, 'Ana Silva', ?, ?, ?, ?)`
  ).run(`evt-${servico}`, servico, telefone, inicio, daqui(ms + HORA), status);
  return inicio;
}

const confirmados = () =>
  db.prepare("SELECT COUNT(*) AS n FROM agendamentos WHERE status = 'confirmado'").get().n;

const postar = (rota, corpo, token = 'token-de-teste') => {
  const req = request(app).post(rota);
  if (token) req.set('X-Webhook-Token', token);
  return req.send(corpo);
};

describe('montarAvisoAmbiguo', () => {
  const itens = [
    { salao: 'Salão X', contato: 'https://wa.me/5521911111111', inicio: '2026-11-28T18:00:00.000Z', servico: 'Corte' },
    { salao: 'Salão Y', contato: 'https://wa.me/5521922222222', inicio: '2026-12-02T10:00:00-03:00', servico: 'Manicure' },
  ];

  test('monta a lista com data e hora de São Paulo', () => {
    expect(montarAvisoAmbiguo(itens, 'America/Sao_Paulo')).toBe(
      'Você tem mais de um horário marcado, então não cancelei nenhum:\n' +
      '• Salão X — 28/11 às 15:00 (Corte)\n' +
      '  Falar com o salão: https://wa.me/5521911111111\n' +
      '• Salão Y — 02/12 às 10:00 (Manicure)\n' +
      '  Falar com o salão: https://wa.me/5521922222222\n' +
      'Para cancelar ou reagendar, fale com o salão.'
    );
  });

  test('salão sem contato vai só com o nome', () => {
    const texto = montarAvisoAmbiguo([{ ...itens[0], contato: '' }], 'America/Sao_Paulo');
    expect(texto).toContain('• Salão X — 28/11 às 15:00 (Corte)');
    expect(texto).not.toContain('Falar com o salão:');
  });
});

describe('POST /webhook-whatsapp/pendentes', () => {
  test('devolve só os pendentes do telefone, do mais próximo ao mais distante', async () => {
    const depois = criar('Depois', 7 * DIA);
    const antes = criar('Antes', DIA);
    criar('Passado', -30 * DIA);
    criar('Cancelado', 2 * DIA, { status: 'cancelado' });
    criar('DeOutro', DIA, { telefone: '5521900000000' });

    const res = await postar('/webhook-whatsapp/pendentes', { from: FROM });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      salao: 'Bya Marcondes',
      contato: '',
      horarios: [{ inicio: antes, servico: 'Antes' }, { inicio: depois, servico: 'Depois' }],
    });
  });

  test('sem senha → 403', async () => {
    expect((await postar('/webhook-whatsapp/pendentes', { from: FROM }, null)).status).toBe(403);
  });

  test('@lid é resolvido pelo WAHA', async () => {
    criar('Corte', DIA);
    jest.spyOn(global, 'fetch').mockResolvedValue({ json: async () => ({ id: FROM }) });
    const res = await postar('/webhook-whatsapp/pendentes', { from: '247647864668171@lid' });
    expect(res.body.horarios).toHaveLength(1);
  });

  // "Não sei quem é" não pode virar "não tem horário": o distribuidor somaria errado.
  test.each([
    ['WAHA fora do ar', () => Promise.reject(new Error('boom'))],
    ['WAHA sem o contato', () => Promise.resolve({ json: async () => ({}) })],
  ])('@lid não resolvido (%s) → 502', async (_, resposta) => {
    jest.spyOn(global, 'fetch').mockImplementation(resposta);
    const res = await postar('/webhook-whatsapp/pendentes', { from: '247647864668171@lid' });
    expect(res.status).toBe(502);
    expect(res.body.horarios).toBeUndefined();
  });
});

describe('POST /webhook-whatsapp/ambiguo', () => {
  const itens = [{ salao: 'Salão X', contato: '', inicio: daqui(DIA), servico: 'Corte' }];

  test('envia a lista sem prefixo de salão e responde 200', async () => {
    const res = await postar('/webhook-whatsapp/ambiguo', { from: FROM, itens });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(enviarWhatsapp).toHaveBeenCalledWith(
      TELEFONE, montarAvisoAmbiguo(itens, 'America/Sao_Paulo'), { semPrefixo: true }
    );
  });

  // enviarWhatsapp não lança erro: devolve { ok: false }. Responder 200 aqui faria o
  // distribuidor achar que a lista saiu e não tentar outro salão (cliente no vácuo).
  test.each([
    ['falha no envio', { ok: false, error: 'HTTP 401' }],
    ['WhatsApp desativado', { ok: false, desativado: true }],
  ])('%s → 502', async (_, resultado) => {
    enviarWhatsapp.mockResolvedValueOnce(resultado);
    expect((await postar('/webhook-whatsapp/ambiguo', { from: FROM, itens })).status).toBe(502);
  });

  test('sem senha → 403', async () => {
    expect((await postar('/webhook-whatsapp/ambiguo', { from: FROM, itens }, null)).status).toBe(403);
    expect(enviarWhatsapp).not.toHaveBeenCalled();
  });

  test.each([[[]], [undefined], ['texto']])('itens %j → 400', async (invalido) => {
    const res = await postar('/webhook-whatsapp/ambiguo', { from: FROM, itens: invalido });
    expect(res.status).toBe(400);
    expect(enviarWhatsapp).not.toHaveBeenCalled();
  });

  test('remetente não resolvido (grupo) → 502', async () => {
    const res = await postar('/webhook-whatsapp/ambiguo', { from: '123@g.us', itens });
    expect(res.status).toBe(502);
    expect(enviarWhatsapp).not.toHaveBeenCalled();
  });
});

describe('trava no próprio salão', () => {
  const responder = async (body) => {
    await postar('/webhook-whatsapp', { event: 'message', payload: { from: FROM, body, fromMe: false } });
    await esperar();
  };

  test.each([['2'], ['3']])('"%s" com dois pendentes não cancela e envia a lista', async (opcao) => {
    criar('Corte', DIA);
    criar('Manicure', 7 * DIA);

    await responder(opcao);

    expect(calendar.events.delete).not.toHaveBeenCalled();
    expect(notificar).not.toHaveBeenCalled();
    expect(confirmados()).toBe(2);
    expect(enviarWhatsapp).toHaveBeenCalledTimes(1);
    const [numero, texto, opcoes] = enviarWhatsapp.mock.calls[0];
    expect(numero).toBe(TELEFONE);
    expect(texto).toContain('não cancelei nenhum');
    expect(texto).toContain('(Corte)');
    expect(texto).toContain('(Manicure)');
    expect(opcoes).toEqual({ semPrefixo: true });
  });

  test('"1" com dois pendentes continua confirmando', async () => {
    criar('Corte', DIA);
    criar('Manicure', 7 * DIA);

    await responder('1');

    expect(confirmados()).toBe(2);
    expect(enviarWhatsapp).toHaveBeenCalledTimes(1);
    expect(enviarWhatsapp.mock.calls[0][1]).not.toContain('não cancelei');
  });
});
