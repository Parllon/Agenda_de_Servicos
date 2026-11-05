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
const { criarColetor } = require('./lib/coletor');
const { criar } = require('./lib/criar');
const { aplicar } = require('./lib/aplicar');
const { deletar } = require('./lib/deletar');
const { pausar, reativar, estaAtivo } = require('./lib/pausar');
const { criarAgendasDoCliente } = require('./lib/agendas');
const { registrarDNS, atualizarConfig, reloadCloudflared } = require('./lib/cloudflare');
const P = require('./lib/pedido');
const Pedidos = require('./lib/pedidos-store');
const { guardarFotos, enfileirar } = require('./lib/provisionar');
const { linksDoCliente } = require('./lib/agenda-links');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const SENHA = process.env.PAINEL_SENHA || '';
const COOKIE_SECRET = process.env.PAINEL_COOKIE_SECRET || (SENHA + '|slotme-painel');

if (!SENHA) {
  console.warn('[painel] AVISO: PAINEL_SENHA vazio — defina no .env do painel antes de usar.');
}

app.set('trust proxy', 1); // Cloudflare tunnel envia X-Forwarded-For
app.use(helmet({
  // Painel roda só em HTTP na LAN (nunca por HTTPS/Cloudflare — ver §15.1).
  // HSTS não tem função aqui (nunca é servido por TLS) — desligado por higiene.
  hsts: false,
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc:  ["'self'", "'unsafe-inline'"],
      styleSrc:   ["'self'", "'unsafe-inline'"],
      imgSrc:     ["'self'", 'data:'],
      connectSrc: ["'self'"],
      // helmet liga upgrade-insecure-requests por padrão quando CSP é
      // configurado. Isso faz o navegador reescrever TODO recurso http da
      // página (styles.css, app.js) pra https — que não existe aqui (sem
      // TLS) — e eles voltam com erro, deixando a tela em branco (só o
      // <title>/<h1> aparecem, nada do app.js roda). Causa real do painel
      // branco em 2026-11-03; não é HSTS nem extensão do navegador.
      upgradeInsecureRequests: null,
    },
  },
}));
// ---- Pedidos do site SlotMe (rota PÚBLICA) ----
// O cadastro de slotme.agendamentos.app.br/cadastro manda o pedido aqui e o
// cliente é criado sozinho (lib/provisionar.js). É a ÚNICA rota pública que
// escreve num painel com acesso ao Docker: validação estrita (lib/pedido.js),
// CORS só do site, limite por IP e teto diário de criações automáticas.
// Fica ANTES do express.json global: precisa de limite maior (fotos em base64).
const corsPedidos = cors({
  origin: (process.env.PEDIDOS_ORIGENS || 'https://slotme.agendamentos.app.br,http://localhost:5173')
    .split(',').map((s) => s.trim()).filter(Boolean),
  methods: ['GET', 'POST'],
});
const limitePedidos = rateLimit({
  windowMs: 60 * 60 * 1000, max: 3, standardHeaders: true, legacyHeaders: false,
  message: { erro: 'Muitos cadastros deste endereço. Tente de novo mais tarde ou chame no WhatsApp.' },
});
const limiteStatus = rateLimit({ windowMs: 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false });
const PEDIDOS_MAX_DIA = parseInt(process.env.PEDIDOS_MAX_DIA || '5', 10);

app.options('/api/pedidos', corsPedidos);
app.post('/api/pedidos', corsPedidos, limitePedidos, express.json({ limit: '4mb' }), (req, res) => {
  const pedido = req.body;
  try {
    P.validarPedido(pedido);
  } catch (e) {
    return res.status(e.status || 400).json({ erro: e.message });
  }

  // Reenvio do mesmo protocolo (duplo clique, rede caiu na volta): devolve o que já existe.
  const existente = Pedidos.ler(pedido.protocolo);
  if (existente) {
    return res.json({
      ok: true, protocolo: existente.protocolo, slug: existente.slug, url: existente.url,
      status: existente.status, chave: existente.chave_status,
    });
  }

  const dup = Pedidos.duplicado({ email: pedido.contato.email_google, whatsapp: pedido.contato.whatsapp });
  if (dup) {
    return res.status(409).json({ erro: 'Já existe um cadastro com este e-mail ou WhatsApp.', codigo: 'duplicado' });
  }

  try {
    const slug = P.escolherSlug(pedido);
    const url = `https://${slug}.${P.DOMINIO}`;
    const avisosFoto = guardarFotos(pedido); // tira as fotos do pedido e guarda em disco
    const automatico = Pedidos.provisionadosUltimas24h() < PEDIDOS_MAX_DIA;
    const reg = Pedidos.novo({ pedido, slug, url, status: automatico ? 'recebido' : 'aguardando' });
    // Chave que só o navegador que enviou conhece: libera o link da agenda no status.
    reg.chave_status = crypto.randomBytes(16).toString('hex');
    reg.avisos.push(...avisosFoto);
    Pedidos.gravar(reg);

    res.status(202).json({ ok: true, protocolo: reg.protocolo, slug, url, status: reg.status, chave: reg.chave_status });
    if (automatico) enfileirar(reg.protocolo);
    else console.warn(`[pedidos] teto diário (${PEDIDOS_MAX_DIA}) atingido — ${reg.protocolo} aguardando liberação no painel.`);
  } catch (e) {
    console.error('[pedidos]', e);
    res.status(500).json({ erro: 'Falha ao registrar o cadastro.' });
  }
});

// Status público (a tela de sucesso do site consulta): só o necessário.
// O link da agenda (dá acesso aos nomes/telefones dos clientes do salão) só vai
// para quem tem a `chave` devolvida no POST — ou seja, o navegador que cadastrou.
function mesmaChave(a, b) {
  const x = Buffer.from(String(a || ''));
  const y = Buffer.from(String(b || ''));
  return x.length > 0 && x.length === y.length && crypto.timingSafeEqual(x, y);
}

app.get('/api/pedidos/:protocolo/status', corsPedidos, limiteStatus, (req, res) => {
  const reg = Pedidos.ler(req.params.protocolo);
  if (!reg) return res.status(404).json({ erro: 'não encontrado' });
  const resposta = { status: reg.status, url: reg.url };
  if (reg.status === 'pronto' && mesmaChave(req.query.chave, reg.chave_status)) {
    try {
      const links = linksDoCliente(reg.slug);
      if (links.ativo) resposta.agenda = links.dono;
    } catch (e) { console.error('[pedidos/status] links da agenda:', e.message); }
  }
  res.json(resposta);
});

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
    // Painel roda só em HTTP puro na LAN (nunca HTTPS/Cloudflare — §15.1).
    // secure:true faz o navegador DESCARTAR o cookie em conexão HTTP: o
    // login respondia "ok" mas a sessão nunca era salva, e a tela voltava
    // pro login. Causa real do "senha não funciona" em 2026-11-03.
    secure: false,
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

app.get('/api/clientes', exigirLogin, async (req, res) => {
  const clientes = C.listar();
  // ativo/inativo/null (nunca aplicado) lido direto do Docker — nunca fica
  // desincronizado da realidade, não depende de nenhum flag salvo em arquivo.
  const comStatus = await Promise.all(
    clientes.map(async (c) => ({ ...c, ativo: await estaAtivo(c.slug) }))
  );
  res.json(comStatus);
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

// Pausa: para os containers, mantém pasta/banco/dados.json/fotos intactos.
app.post('/api/clientes/:slug/pausar', exigirLogin, async (req, res) => {
  const slug = req.params.slug;
  if (!C.existe(slug)) return res.status(404).json({ erro: `cliente '${slug}' não existe` });
  try {
    await pausar(slug);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

// Reativa: religa os containers já existentes (sem reseed).
app.post('/api/clientes/:slug/reativar', exigirLogin, async (req, res) => {
  const slug = req.params.slug;
  if (!C.existe(slug)) return res.status(404).json({ erro: `cliente '${slug}' não existe` });
  try {
    await reativar(slug);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

// Links da agenda por assinatura (iPhone/iCloud) — para mandar à mão ao dono e
// a cada profissional. Ver lib/agenda-links.js e app/agenda-ics.js.
app.get('/api/clientes/:slug/agenda-links', exigirLogin, (req, res) => {
  const slug = req.params.slug;
  if (!C.existe(slug)) return res.status(404).json({ erro: `cliente '${slug}' não existe` });
  try { res.json(linksDoCliente(slug)); }
  catch (e) { res.status(500).json({ erro: e.message }); }
});

// Cria (idempotente) as agendas Google dos profissionais sem calendar_id, via
// service account, e compartilha com negocio.email_dono. Síncrona (responde só
// depois de terminar) — o wizard mostra isso como uma fase própria.
app.post('/api/clientes/:slug/agendas', exigirLogin, async (req, res) => {
  const slug = req.params.slug;
  if (!C.existe(slug)) return res.status(404).json({ erro: `cliente '${slug}' não existe` });
  try {
    const { dados } = C.ler(slug);
    const resultado = await criarAgendasDoCliente(dados); // muta dados em memória
    C.gravar(slug, { dados }); // persiste calendar_id preenchido
    res.json({ ok: resultado.erros.length === 0, ...resultado });
  } catch (e) {
    res.status(400).json({ erro: e.message });
  }
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

// ---- Pedidos do site (admin) ----
// Lista só o resumo (sem o pedido completo nem o log do docker).
app.get('/api/pedidos', exigirLogin, (_req, res) => {
  res.json(Pedidos.listar().map(({ pedido, log_docker, ...resumo }) => ({
    ...resumo, negocio: (pedido && pedido.negocio && pedido.negocio.nome) || '',
  })));
});

// Libera um pedido "aguardando" (teto diário) ou tenta de novo um que deu "erro".
// Continua das fases que faltam (lib/provisionar.js).
app.post('/api/pedidos/:protocolo/reprocessar', exigirLogin, (req, res) => {
  const reg = Pedidos.ler(req.params.protocolo);
  if (!reg) return res.status(404).json({ erro: 'pedido não encontrado' });
  if (reg.status === 'provisionando') return res.status(409).json({ erro: 'já está em andamento' });
  if (reg.status === 'pronto') return res.status(409).json({ erro: 'pedido já concluído' });
  reg.status = 'recebido';
  Pedidos.gravar(reg);
  enfileirar(reg.protocolo);
  res.json({ ok: true });
});

// ---- Métricas ----

// Coletor público (sem auth): recebe eventos das landing pages e do site SlotMe
// via CORS (lib/coletor.js). Protegido por token compartilhado (METRICS_TOKEN) e
// lista fechada de slugs (pastas de cliente + METRICS_SLUGS_EXTRAS) e tipos.
const limiteMetricas = rateLimit({ windowMs: 60 * 1000, max: 300, standardHeaders: true, legacyHeaders: false });
app.use(criarColetor({ limite: limiteMetricas }));

// Dashboard de métricas (protegido por senha).
// { clientes: { <slug>: ... }, site: { <slug extra>: visitas, cliques, funil, por_origem } }
app.get('/api/metricas', exigirLogin, (req, res) => {
  try {
    const { inicio, fim } = req.query;
    const slugs = C.listar().map((c) => c.slug);
    res.json({ clientes: M.getMetricas(slugs, inicio, fim), site: M.getSite(inicio, fim) });
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
  if (!process.env.WAHA_API_KEY) {
    console.warn('[painel] AVISO: WAHA_API_KEY vazio — clientes criados agora nascem sem WhatsApp.');
  }
  // Painel reiniciou no meio de uma criação? Retoma: "recebido" volta pra fila e
  // "provisionando" (interrompido) também — o provisionar pula as fases já ok.
  for (const reg of Pedidos.listar()) {
    if (reg.status === 'recebido' || reg.status === 'provisionando') {
      console.log(`[painel] retomando pedido ${reg.protocolo} (${reg.status})`);
      enfileirar(reg.protocolo);
    }
  }
});
