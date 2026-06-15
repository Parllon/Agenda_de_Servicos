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

// ---- UI estática ----
app.use(express.static(path.join(__dirname, 'public')));

app.listen(PORT, () => {
  console.log(`[painel] no ar em http://0.0.0.0:${PORT}  (raiz do projeto: ${C.PROJETO_RAIZ})`);
});
