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

const cors = require('cors');
const C = require('./lib/clientes');
const M = require('./lib/metricas');
const { criar } = require('./lib/criar');
const { aplicar } = require('./lib/aplicar');
const { deletar } = require('./lib/deletar');
const { registrarDNS, atualizarConfig, reloadCloudflared } = require('./lib/cloudflare');

const app = express();
const PORT = process.env.PORT || 3000;
const SENHA = process.env.PAINEL_SENHA || '';
const COOKIE_SECRET = process.env.PAINEL_COOKIE_SECRET || (SENHA + '|slotme-painel');

if (!SENHA) {
  console.warn('[painel] AVISO: PAINEL_SENHA vazio — defina no .env do painel antes de usar.');
}

app.set('trust proxy', 1); // Cloudflare tunnel envia X-Forwarded-For
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc:  ["'self'", "'unsafe-inline'"],
      styleSrc:   ["'self'", "'unsafe-inline'"],
      imgSrc:     ["'self'", 'data:'],
      connectSrc: ["'self'"],
    },
  },
}));
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser(COOKIE_SECRET));

// ---- Autenticação simples por cookie assinado ----
const COOKIE = 'painel_auth';
function logado(req) { return req.signedCookies[COOKIE] === 'ok'; }
function exigirLogin(req, res, next) {
  if (logado(req)) return next();
  return res.status(401).json({ erro: 'não autenticado' });
}

const limiteLogin = rateLimit({ windowMs: 15 * 60 * 1000, max: 5, skipSuccessfulRequests: true });
app.post('/api/login', limiteLogin, (req, res) => {
  const { senha } = req.body || {};
  if (!SENHA || senha !== SENHA) return res.status(401).json({ erro: 'senha incorreta' });
  res.cookie(COOKIE, 'ok', {
    httpOnly: true,
    sameSite: 'strict',
    secure: true,
    signed: true,
    maxAge: 8 * 60 * 60 * 1000, // 8h
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

app.delete('/api/clientes/:slug', exigirLogin, async (req, res) => {
  const slug = req.params.slug;
  if (!C.existe(slug)) return res.status(404).json({ erro: `cliente '${slug}' não existe` });
  try {
    await deletar(slug);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

app.post('/api/clientes/:slug/aplicar', exigirLogin, (req, res) => {
  const slug = req.params.slug;
  if (!C.existe(slug)) return res.status(404).json({ erro: `cliente '${slug}' não existe` });
  // Responde imediatamente — docker pode demorar >30s e o Cloudflare fecharia a conexão.
  res.json({ ok: true, log: 'subindo em segundo plano' });
  aplicar(slug).catch((e) => console.error(`[aplicar:${slug}]`, e.message));
});

// Próxima porta disponível para novo cliente (usada pelo wizard de cadastro).
app.get('/api/next-porta', exigirLogin, (_req, res) => {
  res.json({ porta: C.proximaPorta() });
});

// Ativa o subdomínio: DNS + config. Responde ANTES do reload para não derrubar o túnel.
app.post('/api/clientes/:slug/cloudflare', exigirLogin, async (req, res) => {
  const slug = req.params.slug;
  const { porta } = req.body || {};
  const r = { dns: false, config: false, reload: true, avisos: [] };

  try { await registrarDNS(slug); r.dns = true; }
  catch (e) { r.avisos.push(`DNS: ${e.message}`); }

  try { atualizarConfig(slug, porta); r.config = true; }
  catch (e) { r.avisos.push(`Config: ${e.message}`); }

  // Envia a resposta antes de reiniciar o cloudflared (o restart derruba o túnel)
  res.json({ ok: true, ...r });

  reloadCloudflared().catch((e) => console.error('[cloudflare reload]', e.message));
});

// ---- Métricas ----

// Coletor público (sem auth): recebe eventos das landing pages via CORS.
// Protegido por token compartilhado (METRICS_TOKEN no .env do painel).
const limiteMetricas = rateLimit({ windowMs: 60 * 1000, max: 300, standardHeaders: true, legacyHeaders: false });
const METRICS_TOKEN = process.env.METRICS_TOKEN || '';
const TIPOS_LP = new Set(['lp_vista', 'lp_clicou_agendar', 'lp_clicou_whatsapp']);

app.post('/api/evento', cors(), limiteMetricas, (req, res) => {
  const token = req.headers['x-metrics-token'] || (req.body && req.body._token) || '';
  if (!METRICS_TOKEN || token !== METRICS_TOKEN) return res.status(403).end();
  const { slug, sessaoId, tipo } = req.body || {};
  if (!slug || !sessaoId || !TIPOS_LP.has(tipo)) return res.status(400).end();
  if (!M.slugExiste(slug)) return res.status(400).end();
  try {
    M.inserirLpEvento(slug, sessaoId, tipo);
  } catch (e) {
    console.error('[metricas/evento]', e.message);
  }
  res.json({ ok: true });
});

// Dashboard de métricas (protegido por senha).
app.get('/api/metricas', exigirLogin, (req, res) => {
  try {
    const { inicio, fim } = req.query;
    const slugs = C.listar().map((c) => c.slug);
    res.json(M.getMetricas(slugs, inicio, fim));
  } catch (e) {
    console.error('[metricas/api]', e.message);
    res.status(500).json({ erro: 'Falha ao carregar métricas' });
  }
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

// Dashboard de métricas (antes do static para não ser mascarado).
app.get('/metricas', (_req, res) => res.sendFile('metricas.html', { root: PUBLIC }));

// Painel de edição de clientes: caminho explícito, acessível inclusive sob cadastro.*
// (a raiz do cadastro.* serve o wizard; aqui é a entrada para o painel admin).
// Os assets (styles.css/app.js) são relativos, então a barra final quebraria a base;
// com routing não-estrito esta rota casa /painel e /painel/ — redirecionamos a versão
// com barra para /painel e servimos o painel só na forma sem barra.
app.get('/painel', (req, res) => {
  if (req.path.endsWith('/')) return res.redirect('/painel');
  res.sendFile('index.html', { root: PUBLIC });
});

app.use(express.static(PUBLIC));

app.listen(PORT, () => {
  console.log(`[painel] no ar em http://0.0.0.0:${PORT}  (raiz do projeto: ${C.PROJETO_RAIZ})`);
});
