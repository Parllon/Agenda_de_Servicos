// tokens-webhook.test.js — todo cliente precisa de WEBHOOK_TOKEN (sem ele o motor
// recusa as respostas do WhatsApp).

const fs = require('fs');
const os = require('os');
const path = require('path');

const RAIZ = fs.mkdtempSync(path.join(os.tmpdir(), 'painel-tokens-'));
process.env.PROJETO_RAIZ = RAIZ;

const { criar } = require('../lib/criar');
const { completarTokens } = require('../lib/tokens-webhook');
const { parseEnv } = require('../lib/env');

const MOLDE = path.join(__dirname, '..', '..', 'clientes', '_template');
const CLIENTES = path.join(RAIZ, 'clientes');
const HEX64 = /^[0-9a-f]{64}$/;

const arqEnv = (slug) => path.join(CLIENTES, slug, '.env');
const ler = (slug) => fs.readFileSync(arqEnv(slug), 'utf8');
const tokenDe = (slug) => parseEnv(ler(slug)).WEBHOOK_TOKEN;

function clienteAntigo(slug, env) {
  fs.mkdirSync(path.join(CLIENTES, slug), { recursive: true });
  fs.writeFileSync(arqEnv(slug), env);
  fs.writeFileSync(path.join(CLIENTES, slug, 'dados.json'), '{"negocio":{"nome":"X"}}');
}

beforeEach(() => {
  fs.rmSync(CLIENTES, { recursive: true, force: true });
  fs.mkdirSync(path.join(CLIENTES, '_template'), { recursive: true });
  for (const f of ['.env', 'docker-compose.yml', 'dados.json']) {
    fs.copyFileSync(path.join(MOLDE, f), path.join(CLIENTES, '_template', f));
  }
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterAll(() => fs.rmSync(RAIZ, { recursive: true, force: true }));

describe('criar()', () => {
  test('cada cliente novo nasce com a própria senha', () => {
    criar({ slug: 'ana', porta: '8201', tema: 'tema_1' });
    criar({ slug: 'bia', porta: '8202', tema: 'tema_1' });

    expect(tokenDe('ana')).toMatch(HEX64);
    expect(tokenDe('bia')).toMatch(HEX64);
    expect(tokenDe('ana')).not.toBe(tokenDe('bia'));
    expect(ler('ana').match(/^WEBHOOK_TOKEN=/gm)).toHaveLength(1);
  });
});

describe('completarTokens()', () => {
  const SEM = 'CLIENTE=sem\n# comentário\nPORTA_EXTERNA=8090   # porta\n';
  const VAZIO = 'CLIENTE=vazio\nWEBHOOK_TOKEN=\nTEMA=tema_1\n';
  const PRONTO = 'CLIENTE=pronto\nWEBHOOK_TOKEN=senha-que-ja-existe\n';

  beforeEach(() => {
    clienteAntigo('sem', SEM);
    clienteAntigo('vazio', VAZIO);
    clienteAntigo('pronto', PRONTO);
  });

  test('cria só para quem não tem e não mexe no resto do .env', () => {
    const r = completarTokens({ simular: false });

    expect(r.alterados.sort()).toEqual(['sem', 'vazio']);
    expect(r.semToken).toEqual([]);
    expect(tokenDe('sem')).toMatch(HEX64);
    expect(tokenDe('vazio')).toMatch(HEX64);
    expect(ler('pronto')).toBe(PRONTO);
    expect(ler('sem')).toContain('# comentário\nPORTA_EXTERNA=8090   # porta\n');
    expect(ler('vazio').replace(/^WEBHOOK_TOKEN=.*$/m, 'WEBHOOK_TOKEN=')).toBe(VAZIO);
  });

  test('rodar de novo não troca nenhuma senha', () => {
    completarTokens({ simular: false });
    const antes = ler('sem') + ler('vazio');

    expect(completarTokens({ simular: false })).toEqual({ alterados: [], semToken: [] });
    expect(ler('sem') + ler('vazio')).toBe(antes);
  });

  test('na simulação nada muda e diz quem está sem senha', () => {
    const r = completarTokens({ simular: true });

    expect(r.alterados.sort()).toEqual(['sem', 'vazio']);
    expect(r.semToken.sort()).toEqual(['sem', 'vazio']);
    expect(ler('sem')).toBe(SEM);
    expect(ler('vazio')).toBe(VAZIO);
  });

  test('um .env que não dá para gravar não impede os outros e é acusado', () => {
    const gravar = fs.writeFileSync;
    jest.spyOn(fs, 'writeFileSync').mockImplementation((arq, ...resto) => {
      if (arq === arqEnv('sem')) throw new Error('somente leitura');
      return gravar.call(fs, arq, ...resto);
    });
    jest.spyOn(console, 'error').mockImplementation(() => {});

    const r = completarTokens({ simular: false });
    jest.restoreAllMocks();

    expect(r.alterados).toEqual(['vazio']);
    expect(r.semToken).toEqual(['sem']);
  });
});
