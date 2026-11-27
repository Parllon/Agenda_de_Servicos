// acesso.test.js — o que o painel entrega pela internet x pela rede local.
// Sobe o server.js DE VERDADE (processo separado) e fala HTTP com ele, forjando o
// cabeçalho Host do jeito que o túnel Cloudflare (ou um atacante) mandaria.

const { spawn } = require('child_process');
const fs = require('fs');
const http = require('http');
const net = require('net');
const os = require('os');
const path = require('path');

const PUBLICO = 'cadastro.agendamentos.app.br';
const LAN = '192.168.1.100:8099';

let servidor;
let porta;
let raiz;

function portaLivre() {
  return new Promise((resolve) => {
    const s = net.createServer().listen(0, () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

function pedir(metodo, caminho, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port: porta, method: metodo, path: caminho, headers },
      (res) => {
        res.resume();
        res.on('end', () => resolve(res.statusCode));
      },
    );
    req.on('error', reject);
    req.end();
  });
}

beforeAll(async () => {
  raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'painel-acesso-'));
  fs.mkdirSync(path.join(raiz, 'clientes'));
  porta = await portaLivre();

  // Banco de mentira só neste teste: nenhuma rota aqui depende de dados, e o
  // binário do better-sqlite3 9.x não existe para o Node 24 do Windows.
  const semBanco = path.join(raiz, 'sem-banco.js');
  fs.writeFileSync(semBanco, `
    const Module = require('module');
    const original = Module._load;
    class BancoFalso {
      pragma() { return []; }
      exec() {}
      prepare() { return { all: () => [], get: () => undefined, run: () => ({}) }; }
      transaction(f) { return f; }
      close() {}
    }
    Module._load = function (pedido, ...resto) {
      return pedido === 'better-sqlite3' ? BancoFalso : original.call(this, pedido, ...resto);
    };
  `);

  servidor = spawn(process.execPath, ['--require', semBanco, path.join(__dirname, '..', 'server.js')], {
    cwd: raiz, // sem .env por perto: o dotenv não carrega nada do desenvolvedor
    env: {
      ...process.env,
      PORT: String(porta),
      PROJETO_RAIZ: raiz,
      PAINEL_SENHA: 'senha-de-teste',
      METRICAS_DB: ':memory:',
      PAINEL_HOSTS_ADMIN: 'zima.exemplo.interno',
    },
  });
  await new Promise((resolve, reject) => {
    let saida = '';
    const ler = (d) => {
      saida += d;
      if (saida.includes('[painel] no ar')) resolve();
    };
    servidor.stdout.on('data', ler);
    servidor.stderr.on('data', ler);
    servidor.on('exit', () => reject(new Error(`painel não subiu:\n${saida}`)));
  });
}, 20000);

afterAll(async () => {
  if (servidor && servidor.exitCode === null) {
    const saiu = new Promise((resolve) => servidor.once('exit', resolve));
    servidor.kill();
    await saiu;
  }
  fs.rmSync(raiz, { recursive: true, force: true });
});

describe('pela internet (host público)', () => {
  test.each([
    ['GET', '/'],
    ['GET', '/painel'],
    ['GET', '/metricas'],
    ['GET', '/metricas/salao/qualquer'],
    ['GET', '/index.html'],
    ['GET', '/cadastro.html'],
    ['GET', '/app.js'],
    ['POST', '/api/login'],
    ['GET', '/api/sessao'],
    ['GET', '/api/meta'],
    ['GET', '/api/clientes'],
    ['PUT', '/api/clientes/qualquer'],
    ['DELETE', '/api/clientes/qualquer'],
    ['POST', '/api/clientes/qualquer/aplicar'],
    ['GET', '/api/pedidos'],
    ['HEAD', '/api/pedidos'],
    ['POST', '/api/pedidos/SLT-ABC123/reprocessar'],
    ['GET', '/api/metricas'],
    ['POST', '/API/LOGIN'],
  ])('esconde %s %s', async (metodo, caminho) => {
    expect(await pedir(metodo, caminho, { Host: PUBLICO })).toBe(404);
  });

  // Rotas que o site SlotMe e as landing pages usam: continuam respondendo.
  // O status esperado é o da PRÓPRIA rota (corpo vazio/token ausente).
  test.each([
    ['OPTIONS', '/api/pedidos', 204],
    ['POST', '/api/pedidos', 400],
    ['OPTIONS', '/api/evento', 204],
    ['POST', '/api/evento', 403],
  ])('mantém %s %s no ar', async (metodo, caminho, esperado) => {
    expect(await pedir(metodo, caminho, { Host: PUBLICO })).toBe(esperado);
  });

  test('mantém a consulta de status: 404 vem da rota, não do bloqueio', async () => {
    const corpo = await new Promise((resolve, reject) => {
      http.get(
        { host: '127.0.0.1', port: porta, path: '/api/pedidos/SLT-ABC123/status', headers: { Host: PUBLICO } },
        (res) => {
          let t = '';
          res.on('data', (d) => { t += d; });
          res.on('end', () => resolve(t));
        },
      ).on('error', reject);
    });
    expect(JSON.parse(corpo)).toEqual({ erro: 'não encontrado' });
  });
});

describe('tentativas de se passar por rede local', () => {
  test('X-Forwarded-Host falso não libera a administração', async () => {
    const status = await pedir('GET', '/api/sessao', { Host: PUBLICO, 'X-Forwarded-Host': LAN });
    expect(status).toBe(404);
  });

  test.each(['cf-connecting-ip', 'cf-ray'])(
    'pedido que passou pelo Cloudflare (%s) é público mesmo com Host de LAN',
    async (cabecalho) => {
      expect(await pedir('GET', '/api/sessao', { Host: LAN, [cabecalho]: 'x' })).toBe(404);
    },
  );

  test.each([
    '192.168.1.100.exemplo.com',
    'localhost.exemplo.com',
    '8.8.8.8',
    '172.32.0.1',
    'outro-dominio.com.br',
  ])('Host %s não é tratado como rede local', async (host) => {
    expect(await pedir('GET', '/api/sessao', { Host: host })).toBe(404);
  });
});

describe('pela rede local', () => {
  test.each([
    LAN,
    '127.0.0.1',
    'localhost:8099',
    '10.0.0.5:8099',
    '172.16.0.9',
    '[::1]:8099',
    'zimaos.local:8099',
    'zima.exemplo.interno',
  ])('administração funciona com Host %s', async (host) => {
    expect(await pedir('GET', '/api/sessao', { Host: host })).toBe(200);
  });

  test.each(['/painel', '/cadastro.html', '/metricas'])('tela %s abre', async (caminho) => {
    expect(await pedir('GET', caminho, { Host: LAN })).toBe(200);
  });

  test('rota com login continua pedindo login', async () => {
    expect(await pedir('GET', '/api/clientes', { Host: LAN })).toBe(401);
  });
});
