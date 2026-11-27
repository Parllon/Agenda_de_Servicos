// contrato-distribuidor.test.js — distribuidor e DOIS salões reais conversando por
// HTTP (cada salão com o seu banco e a sua senha). Só Google, WhatsApp e Telegram
// são falsos. Garante que os dois lados concordam sobre rotas, senha e formato.

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

const { tratarWebhook } = require('../webhook-dispatcher');

const TELEFONE = '5521999998888';
const MENSAGEM = JSON.stringify({
  event: 'message', payload: { from: `${TELEFONE}@c.us`, body: '3', fromMe: false },
});
const DIA = 24 * 3600000;
const esperar = () => new Promise((r) => setTimeout(r, 100));

function subirSalao(slug, nome) {
  const antes = { ...process.env };
  process.env.WEBHOOK_TOKEN = `senha-${slug}`;
  process.env.NEGOCIO_NOME = nome;
  const salao = { slug };
  jest.isolateModules(() => {
    salao.db = require('../db');
    salao.enviar = require('../whatsapp').enviarWhatsapp;
    salao.apagar = jest.fn().mockResolvedValue({});
    require('../google').getCalendarClient.mockReturnValue({ events: { delete: salao.apagar } });
    salao.app = require('../server');
  });
  process.env = antes;
  salao.db.prepare("INSERT INTO profissionais (id, nome, calendar_id) VALUES (1, 'P', 'cal')").run();
  return new Promise((pronto) => {
    salao.servidor = salao.app.listen(0, '127.0.0.1', () => {
      salao.alvo = { slug, host: '127.0.0.1', porta: salao.servidor.address().port, token: `senha-${slug}` };
      pronto(salao);
    });
  });
}

function marcar(salao, servico, dias) {
  const inicio = new Date(Date.now() + dias * DIA).toISOString();
  const fim = new Date(Date.now() + dias * DIA + 3600000).toISOString();
  salao.db.prepare(
    `INSERT INTO agendamentos
       (google_event_id, profissional_id, servico_nome, cliente_nome, cliente_telefone, inicio, fim)
     VALUES ('evt', 1, ?, 'Ana Silva', ?, ?, ?)`
  ).run(servico, TELEFONE, inicio, fim);
}

const status = (salao) => salao.db.prepare('SELECT status FROM agendamentos').all().map((a) => a.status);
const alvos = () => [x.alvo, y.alvo];
let x;
let y;

beforeAll(async () => {
  for (const m of ['log', 'warn', 'error']) jest.spyOn(console, m).mockImplementation(() => {});
  x = await subirSalao('x', 'Salão X');
  y = await subirSalao('y', 'Salão Y');
});
afterAll(async () => {
  await Promise.all([x, y].map((s) => new Promise((r) => s.servidor.close(r))));
});
afterEach(() => {
  for (const s of [x, y]) {
    s.db.prepare('DELETE FROM agendamentos').run();
    s.enviar.mockClear();
    s.apagar.mockClear();
  }
});

const envios = () => [...x.enviar.mock.calls, ...y.enviar.mock.calls];

test('um horário em cada salão: nenhum é cancelado e o cliente recebe uma única lista', async () => {
  marcar(x, 'Corte', 1);
  marcar(y, 'Manicure', 7);

  await tratarWebhook(MENSAGEM, alvos());
  await esperar();

  expect(status(x)).toEqual(['confirmado']);
  expect(status(y)).toEqual(['confirmado']);
  expect(x.apagar).not.toHaveBeenCalled();
  expect(y.apagar).not.toHaveBeenCalled();
  expect(envios()).toHaveLength(1);
  const [numero, texto, opcoes] = envios()[0];
  expect(numero).toBe(TELEFONE);
  expect(opcoes).toEqual({ semPrefixo: true });
  expect(texto).toMatch(/Salão X — .*\(Corte\)[\s\S]*Salão Y — .*\(Manicure\)/);
});

test('um horário só: é cancelado no salão certo', async () => {
  marcar(y, 'Manicure', 7);

  await tratarWebhook(MENSAGEM, alvos());
  await esperar();

  expect(status(y)).toEqual(['cancelado']);
  expect(y.apagar).toHaveBeenCalledTimes(1);
  expect(x.apagar).not.toHaveBeenCalled();
  expect(envios()).toHaveLength(1);
});

test('com a senha errada o salão recusa e nada é cancelado', async () => {
  marcar(y, 'Manicure', 7);

  await tratarWebhook(MENSAGEM, [x.alvo, { ...y.alvo, token: 'errada' }]);
  await esperar();

  expect(status(y)).toEqual(['confirmado']);
  expect(envios()).toHaveLength(0);
});
