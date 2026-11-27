// webhook-respostas.test.js — respostas 1/2/3 do WhatsApp: qual agendamento é afetado.

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
const app = require('../server');
const db = require('../db');

const TELEFONE = '5521999998888';
const HORA = 3600000;
const DIA = 24 * HORA;

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
});

// Instante relativo a agora, no formato que o navegador envia (UTC, com "Z").
const daqui = (ms) => new Date(Date.now() + ms).toISOString();

// O mesmo instante escrito com o deslocamento de São Paulo (-03:00).
const emSaoPaulo = (ms) =>
  new Date(Date.now() + ms - 3 * HORA).toISOString().replace('Z', '-03:00');

// Cria um agendamento 'confirmado' de 1h que começa em `inicio`.
function criar(eventoId, inicio, fim) {
  db.prepare(
    `INSERT INTO agendamentos
       (google_event_id, profissional_id, servico_nome, cliente_nome, cliente_telefone, inicio, fim)
     VALUES (?, 1, 'Corte', 'Ana Silva', ?, ?, ?)`
  ).run(eventoId, TELEFONE, inicio, fim);
}

const criarEm = (eventoId, ms) => criar(eventoId, daqui(ms), daqui(ms + HORA));

const statusDe = (eventoId) =>
  db.prepare('SELECT status FROM agendamentos WHERE google_event_id = ?').get(eventoId).status;

// O webhook responde 200 antes de processar; a espera deixa o processamento terminar.
async function responder(texto) {
  await request(app)
    .post('/webhook-whatsapp')
    .send({ event: 'message', payload: { from: `${TELEFONE}@c.us`, body: texto, fromMe: false } });
  await new Promise((r) => setTimeout(r, 50));
}

describe.each([['2'], ['3']])('resposta "%s"', (opcao) => {
  test('cancela o horário futuro e não toca no que já passou', async () => {
    criarEm('evt-passado', -30 * DIA);
    criarEm('evt-futuro', DIA);

    await responder(opcao);

    expect(calendar.events.delete).toHaveBeenCalledTimes(1);
    expect(calendar.events.delete).toHaveBeenCalledWith({
      calendarId: 'test@gmail.com', eventId: 'evt-futuro',
    });
    expect(statusDe('evt-futuro')).toBe('cancelado');
    expect(statusDe('evt-passado')).toBe('confirmado');
  });

  test('só com horário passado: não apaga nada nem avisa o salão', async () => {
    criarEm('evt-passado', -30 * DIA);

    await responder(opcao);

    expect(calendar.events.delete).not.toHaveBeenCalled();
    expect(notificar).not.toHaveBeenCalled();
    expect(statusDe('evt-passado')).toBe('confirmado');
    expect(enviarWhatsapp).toHaveBeenCalledWith(TELEFONE, expect.stringContaining('Não encontrei'));
  });
});

describe('escolha do agendamento', () => {
  test('com dois horários futuros, vale o mais próximo', async () => {
    criarEm('evt-semana-que-vem', 7 * DIA);
    criarEm('evt-amanha', DIA);

    await responder('3');

    expect(statusDe('evt-amanha')).toBe('cancelado');
    expect(statusDe('evt-semana-que-vem')).toBe('confirmado');
  });

  test('horário em andamento ainda pode ser cancelado (cliente atrasado)', async () => {
    criarEm('evt-agora', -HORA / 4);
    criarEm('evt-semana-que-vem', 7 * DIA);

    await responder('3');

    expect(statusDe('evt-agora')).toBe('cancelado');
    expect(statusDe('evt-semana-que-vem')).toBe('confirmado');
  });

  // Comparar as datas como texto erraria aqui: "-03:00" escreve a hora 3h "atrás" do UTC.
  test('entende data gravada com deslocamento -03:00', async () => {
    criar('evt-sp', emSaoPaulo(HORA), emSaoPaulo(2 * HORA));

    await responder('3');

    expect(statusDe('evt-sp')).toBe('cancelado');
  });
});
