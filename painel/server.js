// server.js — Painel admin local do SlotMe.
// Serve a UI (public/) e uma API protegida por senha para criar/editar/aplicar clientes.
// ATENÇÃO: este painel tem acesso ao Docker do host. NUNCA exponha no Cloudflare —
// só na LAN, atrás da senha (PAINEL_SENHA). Ver DOCUMENTACAO-SLOTME.md §15.

require('dotenv').config();
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');

const C = require('./lib/clientes');
const { criar } = require('./lib/criar');
const { aplicar } = require('./lib/aplicar');
const { ativarSubdominio } = require('./lib/cloudflare');

const app = express();
const PORT = process.env.PORT || 3000;
const SENHA = process.env.PAINEL_SENHA || '';
const COOKIE_SECRET = process.env.PAINEL_COOKIE_SECRET || (SENHA + '|slotme-painel');

if (!SENHA) {
  console.warn('[painel] AVISO: PAINEL_SENHA vazio — defina no .env do painel antes de usar.');
}

app.use(helmet({ contentSecurityPolicy: false })); // CSP off: ferramenta de LAN, UI própria
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser(COOKIE_SECRET));

// ---- Autenticação simples por cookie assinado ----
const COOKIE = 'painel_auth';
function logado(req) { return req.signedCookies[COOKIE] === 'ok'; }
function exigirLogin(req, res, next) {
  if (logado(req)) return next();
  return res.status(401).json({ erro: 'não autenticado' });
}

const limiteLogin = rateLimit({ windowMs: 5 * 60 * 1000, max: 10 });
app.post('/api/login', limiteLogin, (req, res) => {
  const { senha } = req.body || {};
  if (!SENHA || senha !== SENHA) return res.status(401).json({ erro: 'senha incorreta' });
  res.cookie(COOKIE, 'ok', {
    httpOnly: true, sameSite: 'lax', signed: true,
    maxAge: 12 * 60 * 60 * 1000, // 12h
  });
  res.json({ ok: true });
});
app.post('/api/logout', (req, res) => { res.clearCookie(COOKIE); res.json({ ok: true }); });
app.get('/api/sessao', (req, res) => res.json({ logado: logado(req) }));

// ---- API (tudo protegido) ----
app.get('/api/meta', exigirLogin, (req, res) => {
  res.json({ temas: C.TEMAS, perfis: C.PERFIS, envEditaveis: C.ENV_EDITAVEIS });
});

app.get('/api/clientes', exigirLogin, (req, res) => {
  res.json(C.listar());
});

app.get('/api/clientes/:slug', exigirLogin, (req, res) => {
  try {
    res.json(C.ler(req.params.slug));
  } catch (e) { res.status(404).json({ erro: e.message }); }
});

app.put('/api/clientes/:slug', exigirLogin, (req, res) => {
  try {
    C.gravar(req.params.slug, req.body || {});
    res.json({ ok: true });
  } catch (e) { res.status(400).json({ erro: e.message }); }
});

app.post('/api/clientes', exigirLogin, (req, res) => {
  try {
    const r = criar(req.body || {});
    res.json({ ok: true, ...r });
  } catch (e) { res.status(400).json({ erro: e.message }); }
});

app.post('/api/clientes/:slug/aplicar', exigirLogin, async (req, res) => {
  try {
    const log = await aplicar(req.params.slug);
    res.json({ ok: true, log });
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

// Próxima porta disponível para novo cliente (usada pelo wizard de cadastro).
app.get('/api/next-porta', exigirLogin, (_req, res) => {
  res.json({ porta: C.proximaPorta() });
});

// Ativa o subdomínio do cliente: DNS na Cloudflare + atualiza config + tenta reload.
app.post('/api/clientes/:slug/cloudflare', exigirLogin, async (req, res) => {
  try {
    const { porta } = req.body || {};
    const resultado = await ativarSubdominio(req.params.slug, porta);
    res.json({ ok: true, ...resultado });
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

// ---- UI estática ----
const PUBLIC = path.join(__dirname, 'public');

// Raiz: serve o wizard mobile quando acessado via cadastro.*, senão o painel normal.
app.get('/', (req, res, next) => {
  if (req.hostname && req.hostname.startsWith('cadastro.')) {
    return res.sendFile('cadastro.html', { root: PUBLIC });
  }
  next();
});

app.use(express.static(PUBLIC));

app.listen(PORT, () => {
  console.log(`[painel] no ar em http://0.0.0.0:${PORT}  (raiz do projeto: ${C.PROJETO_RAIZ})`);
});
