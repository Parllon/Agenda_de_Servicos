// api.test.js — testes de integração das rotas HTTP (supertest + mocks).
// google.js, whatsapp.js e telegram.js são mockados: nenhuma chamada externa sai.

const request = require('supertest');

// ─── Mocks declarados antes do require('../server') ───────────────────────────

jest.mock('../google', () => ({ getCalendarClient: jest.fn() }));
jest.mock('../whatsapp', () => ({
  enviarWhatsapp: jest.fn().mockResolvedValue({}),
  modoWhatsapp: jest.fn().mockReturnValue('proprio'),
}));
jest.mock('../telegram', () => ({
  notificar: jest.fn(),
  montarAviso: jest.fn().mockReturnValue(''),
  htmlParaWhatsapp: jest.fn((t) => t),
}));

const { getCalendarClient } = require('../google');
const app = require('../server');
const db = require('../db');

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Retorna um objeto calendar mockado com freebusy livre por padrão.
function mockCalendar(busySlots = []) {
  return {
    freebusy: {
      query: jest.fn().mockResolvedValue({
        data: { calendars: { 'test@gmail.com': { busy: busySlots } } },
      }),
    },
    events: {
      insert: jest.fn().mockResolvedValue({ data: { id: 'evt-test-123' } }),
      delete: jest.fn().mockResolvedValue({}),
    },
  };
}

// Data no futuro dentro da janela de agendamento (JANELA_DIAS=60).
function dataFutura(diasAFrente = 7, hora = 10) {
  const d = new Date();
  d.setDate(d.getDate() + diasAFrente);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(hora).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}T${hh}:00:00-03:00`;
}

// Payload mínimo válido para POST /agendamento.
function payloadValido(overrides = {}) {
  const inicio = dataFutura(7, 10);
  const fim = dataFutura(7, 11);
  return {
    profissionalId: 1,
    servicoNome: 'Serviço Teste',
    valor: 100,
    clienteNome: 'Ana Silva',
    clienteTelefone: '5521999998888',
    inicio,
    fim,
    ...overrides,
  };
}

// ─── Seed e limpeza ───────────────────────────────────────────────────────────

beforeAll(() => {
  // Garante um profissional e um serviço no banco em memória.
  db.prepare(
    `INSERT OR IGNORE INTO profissionais (id, nome, calendar_id, subject_email, foto_url, telegram_chat_id)
     VALUES (1, 'Profissional Teste', 'test@gmail.com', NULL, NULL, NULL)`
  ).run();
  db.prepare(
    `INSERT OR IGNORE INTO servicos (id, nome, duracao_min, valor, profissional_id)
     VALUES (1, 'Serviço Teste', 60, 100.00, 1)`
  ).run();
});

beforeEach(() => {
  getCalendarClient.mockReturnValue(mockCalendar());
});

afterEach(() => {
  // Limpa agendamentos entre testes para evitar estado compartilhado.
  db.prepare('DELETE FROM agendamentos').run();
  jest.clearAllMocks();
});

// ─── GET /profissionais ───────────────────────────────────────────────────────

describe('GET /profissionais', () => {
  test('retorna 200 e array com os profissionais', async () => {
    const res = await request(app).get('/profissionais');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);
    expect(res.body[0]).toHaveProperty('id');
    expect(res.body[0]).toHaveProperty('nome');
  });
});

// ─── GET /servicos ────────────────────────────────────────────────────────────

describe('GET /servicos', () => {
  test('retorna 200 com lista de serviços do profissional', async () => {
    const res = await request(app).get('/servicos?profissionalId=1');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body[0]).toMatchObject({ nome: 'Serviço Teste', duracao_min: 60 });
  });

  test('retorna lista vazia para profissional inexistente', async () => {
    const res = await request(app).get('/servicos?profissionalId=999');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});

// ─── GET /horarios-disponiveis ────────────────────────────────────────────────

describe('GET /horarios-disponiveis', () => {
  test('retorna 400 quando falta profissionalId', async () => {
    const res = await request(app).get('/horarios-disponiveis?data=2099-01-10');
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('erro');
  });

  test('retorna 400 quando falta data', async () => {
    const res = await request(app).get('/horarios-disponiveis?profissionalId=1');
    expect(res.status).toBe(400);
  });

  test('retorna lista de horários para dia válido', async () => {
    const data = dataFutura(7).slice(0, 10); // "YYYY-MM-DD"
    const res = await request(app).get(
      `/horarios-disponiveis?profissionalId=1&data=${data}&duracaoMin=60`
    );
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('horarios');
    expect(Array.isArray(res.body.horarios)).toBe(true);
  });

  test('retorna vazio para data no passado', async () => {
    const res = await request(app).get(
      '/horarios-disponiveis?profissionalId=1&data=2000-01-01&duracaoMin=60'
    );
    expect(res.status).toBe(200);
    expect(res.body.horarios).toEqual([]);
  });
});

// ─── POST /agendamento — validações ──────────────────────────────────────────

describe('POST /agendamento — validações', () => {
  test('retorna 400 se profissionalId está ausente', async () => {
    const res = await request(app)
      .post('/agendamento')
      .send(payloadValido({ profissionalId: undefined }));
    expect(res.status).toBe(400);
  });

  test('retorna 400 se clienteNome tem apenas um nome (sem sobrenome)', async () => {
    const res = await request(app)
      .post('/agendamento')
      .send(payloadValido({ clienteNome: 'Ana' }));
    expect(res.status).toBe(400);
    expect(res.body.erro).toMatch(/sobrenome/i);
  });

  test('retorna 400 se telefone é inválido', async () => {
    const res = await request(app)
      .post('/agendamento')
      .send(payloadValido({ clienteTelefone: '123' }));
    expect(res.status).toBe(400);
    expect(res.body.erro).toMatch(/telefone/i);
  });

  test('retorna 400 se data está no passado', async () => {
    const res = await request(app)
      .post('/agendamento')
      .send(payloadValido({ inicio: '2000-01-01T10:00:00-03:00', fim: '2000-01-01T11:00:00-03:00' }));
    expect(res.status).toBe(400);
  });

  test('retorna 404 se profissional não existe no banco', async () => {
    const res = await request(app)
      .post('/agendamento')
      .send(payloadValido({ profissionalId: 999 }));
    expect(res.status).toBe(404);
  });
});

// ─── POST /agendamento — fluxo feliz ─────────────────────────────────────────

describe('POST /agendamento — agendamento bem-sucedido', () => {
  test('retorna 201 e eventId quando o slot está livre', async () => {
    const res = await request(app)
      .post('/agendamento')
      .send(payloadValido());
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ ok: true, eventId: 'evt-test-123' });
  });

  test('persiste o agendamento no banco', async () => {
    await request(app).post('/agendamento').send(payloadValido());
    const ag = db.prepare('SELECT * FROM agendamentos WHERE cliente_nome = ?').get('Ana Silva');
    expect(ag).toBeTruthy();
    expect(ag.servico_nome).toBe('Serviço Teste');
    expect(ag.status).toBe('confirmado');
  });

  test('chama events.insert com calendarId correto', async () => {
    const cal = mockCalendar();
    getCalendarClient.mockReturnValue(cal);

    await request(app).post('/agendamento').send(payloadValido());

    expect(cal.events.insert).toHaveBeenCalledWith(
      expect.objectContaining({ calendarId: 'test@gmail.com' })
    );
  });
});

// ─── POST /agendamento — conflito de horário ──────────────────────────────────

describe('POST /agendamento — conflito', () => {
  test('retorna 409 quando o slot já está ocupado no Google Calendar', async () => {
    const inicio = dataFutura(7, 10);
    const fim = dataFutura(7, 11);

    // Simula freebusy retornando o horário como ocupado.
    const cal = {
      freebusy: {
        query: jest.fn().mockResolvedValue({
          data: {
            calendars: {
              'test@gmail.com': { busy: [{ start: inicio, end: fim }] },
            },
          },
        }),
      },
      events: { insert: jest.fn(), delete: jest.fn() },
    };
    getCalendarClient.mockReturnValue(cal);

    const res = await request(app)
      .post('/agendamento')
      .send(payloadValido({ inicio, fim }));

    expect(res.status).toBe(409);
    expect(cal.events.insert).not.toHaveBeenCalled();
  });
});
