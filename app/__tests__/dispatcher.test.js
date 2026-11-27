// dispatcher.test.js — o distribuidor repassa, ou barra "2"/"3" ambíguo.

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { alvosCentral, enviarHttp, tratarWebhook } = require('../webhook-dispatcher');

const FROM = '5521999998888@c.us';
const REPASSE = '/webhook-whatsapp';
const CONSULTA = '/webhook-whatsapp/pendentes';
const AVISO = '/webhook-whatsapp/ambiguo';

const mensagem = (body, extra = {}) =>
  JSON.stringify({ event: 'message', payload: { from: FROM, body, fromMe: false, ...extra } });

const alvo = (slug) => ({ slug, host: `${slug}-app`, porta: 3000, token: `token-${slug}` });
const ALVOS = [alvo('x'), alvo('y'), alvo('z')];

const horario = (inicio, servico) => ({ inicio, servico });
const H1 = horario('2026-11-28T18:00:00.000Z', 'Corte'); // 15:00 em SP
const H2 = horario('2026-12-02T10:00:00-03:00', 'Manicure');
const H0 = horario('2026-11-28T14:00:00-03:00', 'Barba'); // 14:00 em SP: antes de H1

// Salões falsos. `pendentes[slug]`: lista de horários, ou uma função que devolve a
// resposta crua da consulta. `aviso[slug]`: status devolvido por /ambiguo.
function saloes(pendentes = {}, aviso = {}) {
  const chamadas = [];
  const enviar = jest.fn(async (a, caminho, corpo) => {
    chamadas.push({ slug: a.slug, caminho, corpo });
    if (caminho === CONSULTA) {
      const p = pendentes[a.slug] || [];
      if (typeof p === 'function') return p();
      return {
        status: 200,
        corpo: JSON.stringify({ salao: `Salão ${a.slug}`, contato: `https://wa.me/${a.slug}`, horarios: p }),
      };
    }
    if (caminho === AVISO) return { status: aviso[a.slug] || 200, corpo: '{"ok":true}' };
    return { status: 200, corpo: 'OK' };
  });
  const de = (caminho) => chamadas.filter((c) => c.caminho === caminho);
  return { enviar, de };
}

let logs;
beforeEach(() => {
  logs = [];
  for (const m of ['log', 'warn', 'error']) {
    jest.spyOn(console, m).mockImplementation((...a) => logs.push(a.join(' ')));
  }
});
afterEach(() => jest.restoreAllMocks());

function esperarRepasse(s, corpo) {
  expect(s.de(REPASSE).map((c) => c.slug)).toEqual(['x', 'y', 'z']);
  for (const c of s.de(REPASSE)) expect(c.corpo).toBe(corpo);
  expect(s.de(AVISO)).toHaveLength(0);
}

describe('repassa sem consultar', () => {
  test.each([
    ['"1"', mensagem('1')],
    ['"oi"', mensagem('oi')],
    ['mensagem própria', mensagem('3', { fromMe: true })],
    ['outro evento', JSON.stringify({ event: 'session.status', payload: { body: '3' } })],
    ['corpo que não é JSON', 'isso não é json'],
    ['JSON "null"', 'null'],
    ['body que não é texto', mensagem({ n: 3 })],
  ])('%s', async (_, corpo) => {
    const s = saloes({ x: [H1], y: [H2] });
    await tratarWebhook(corpo, ALVOS, s.enviar);
    expect(s.de(CONSULTA)).toHaveLength(0);
    esperarRepasse(s, corpo);
  });
});

describe('"2"/"3" com no máximo um pendente', () => {
  test.each([['nenhum', {}], ['um', { y: [H1] }]])('%s: consulta todos e repassa', async (_, p) => {
    const s = saloes(p);
    await tratarWebhook(mensagem('3'), ALVOS, s.enviar);
    expect(s.de(CONSULTA).map((c) => c.slug)).toEqual(['x', 'y', 'z']);
    for (const c of s.de(CONSULTA)) expect(JSON.parse(c.corpo)).toEqual({ from: FROM });
    esperarRepasse(s, mensagem('3'));
  });
});

describe('"2"/"3" ambíguo', () => {
  test.each([
    ['dois no mesmo salão', { y: [H1, H2] }, 'y'],
    ['um em cada de dois salões', { y: [H1], z: [H2] }, 'y'],
  ])('%s: não repassa e um só salão envia a lista', async (_, p, quemEnvia) => {
    const s = saloes(p);
    await tratarWebhook(mensagem('2'), ALVOS, s.enviar);
    expect(s.de(REPASSE)).toHaveLength(0);
    expect(s.de(AVISO).map((c) => c.slug)).toEqual([quemEnvia]);
  });

  test('a lista junta os salões, ordenada pelo horário real', async () => {
    const s = saloes({ x: [H1], z: [H0, H2] });
    await tratarWebhook(mensagem('3'), ALVOS, s.enviar);
    const { from, itens } = JSON.parse(s.de(AVISO)[0].corpo);
    expect(from).toBe(FROM);
    expect(itens).toEqual([
      { salao: 'Salão z', contato: 'https://wa.me/z', ...H0 },
      { salao: 'Salão x', contato: 'https://wa.me/x', ...H1 },
      { salao: 'Salão z', contato: 'https://wa.me/z', ...H2 },
    ]);
  });

  test.each([[' 3\n'], ['2 ']])('resposta %j também passa pela trava', async (texto) => {
    const s = saloes({ x: [H1], y: [H2] });
    await tratarWebhook(mensagem(texto), ALVOS, s.enviar);
    expect(s.de(REPASSE)).toHaveLength(0);
    expect(s.de(AVISO)).toHaveLength(1);
  });

  test('se o primeiro salão falhar ao enviar, tenta o próximo', async () => {
    const s = saloes({ x: [H1], y: [H2] }, { x: 500 });
    await tratarWebhook(mensagem('3'), ALVOS, s.enviar);
    expect(s.de(AVISO).map((c) => c.slug)).toEqual(['x', 'y']);
    expect(s.de(REPASSE)).toHaveLength(0);
  });

  test('mesmo que todos falhem ao enviar, nunca repassa', async () => {
    const s = saloes({ x: [H1], y: [H2] }, { x: 500, y: 502 });
    await tratarWebhook(mensagem('3'), ALVOS, s.enviar);
    expect(s.de(AVISO).map((c) => c.slug)).toEqual(['x', 'y']);
    expect(s.de(REPASSE)).toHaveLength(0);
  });
});

describe('salão que não responde à consulta', () => {
  test.each([
    ['fora do ar', () => Promise.reject(new Error('ECONNREFUSED'))],
    ['versão antiga (404)', () => ({ status: 404, corpo: 'Cannot POST' })],
    ['HTML com 200', () => ({ status: 200, corpo: '<html>' })],
    ['JSON sem horarios', () => ({ status: 200, corpo: '{"ok":true}' })],
    ['JSON "null"', () => ({ status: 200, corpo: 'null' })],
  ])('%s: ignorado e registrado no log', async (_, falha) => {
    const s = saloes({ x: falha, y: [H1] });
    await tratarWebhook(mensagem('3'), ALVOS, s.enviar);
    expect(s.de(REPASSE)).toHaveLength(3);
    expect(logs.some((l) => l.includes('x') && l.includes('sem resposta'))).toBe(true);
  });

  test('os que responderam ainda barram a ambiguidade', async () => {
    const s = saloes({ x: () => Promise.reject(new Error('timeout')), y: [H1], z: [H2] });
    await tratarWebhook(mensagem('3'), ALVOS, s.enviar);
    expect(s.de(REPASSE)).toHaveLength(0);
    expect(s.de(AVISO).map((c) => c.slug)).toEqual(['y']);
  });
});

describe('alvosCentral', () => {
  let dir;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dispatcher-')); });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  const cliente = (slug, env) => {
    fs.mkdirSync(path.join(dir, slug));
    fs.writeFileSync(path.join(dir, slug, '.env'), env);
  };

  test('lê o token só de quem está em modo central', () => {
    cliente('ana', 'CLIENTE=ana\nWHATSAPP_MODE=central\nWEBHOOK_TOKEN=segredo-ana   # comentário\n');
    cliente('bia', 'CLIENTE=bia\nWHATSAPP_MODE=desativado\nWEBHOOK_TOKEN=segredo-bia\n');
    cliente('_template', 'WHATSAPP_MODE=central\nWEBHOOK_TOKEN=molde\n');

    expect(alvosCentral(dir)).toEqual([
      { slug: 'ana', host: 'ana-app', porta: 3000, token: 'segredo-ana' },
    ]);
  });

  test('avisa quando falta o token, sem mostrar o de ninguém', () => {
    cliente('ana', 'CLIENTE=ana\nWHATSAPP_MODE=central\nWEBHOOK_TOKEN=segredo-ana\n');
    cliente('caio', 'CLIENTE=caio\nWHATSAPP_MODE=central\n');

    expect(alvosCentral(dir).map((a) => a.token)).toEqual(['segredo-ana', '']);
    expect(logs.some((l) => l.includes('caio') && l.includes('WEBHOOK_TOKEN'))).toBe(true);
    expect(logs.join('\n')).not.toContain('segredo-ana');
  });
});

describe('enviarHttp', () => {
  let servidor;
  let recebido;
  beforeAll((fim) => {
    servidor = http.createServer((req, res) => {
      let corpo = '';
      req.on('data', (c) => { corpo += c; });
      req.on('end', () => {
        recebido = { url: req.url, token: req.headers['x-webhook-token'], corpo };
        res.writeHead(201);
        res.end('{"salao":"Salão ç"}');
      });
    });
    servidor.listen(0, '127.0.0.1', fim);
  });
  afterAll((fim) => { servidor.close(fim); });

  test('envia o token no cabeçalho e devolve status e corpo', async () => {
    const destino = { slug: 'ana', host: '127.0.0.1', porta: servidor.address().port, token: 'segredo-ana' };
    const r = await enviarHttp(destino, CONSULTA, '{"from":"ç"}');
    expect(r).toEqual({ status: 201, corpo: '{"salao":"Salão ç"}' });
    expect(recebido).toEqual({ url: CONSULTA, token: 'segredo-ana', corpo: '{"from":"ç"}' });
  });

  test('rejeita quando não há ninguém na porta', async () => {
    await expect(enviarHttp({ slug: 'z', host: '127.0.0.1', porta: 1, token: '' }, REPASSE, '{}'))
      .rejects.toThrow();
  });
});
