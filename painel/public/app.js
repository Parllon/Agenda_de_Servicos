// app.js — lógica do painel: login, lista, formulário (editar/criar) e aplicar.
// Sem framework: fetch + DOM, no mesmo espírito do app/public/app.js do motor.

const TIPOS_MSG = ['confirmacao', 'vespera', 'lembrete1h', 'reagendar', 'confirmado', 'cancelado'];
let META = { temas: [], perfis: [] };
let modoCriar = false;      // true = formulário criando cliente novo
let slugAtual = null;       // slug em edição

const $ = (id) => document.getElementById(id);
const mostrar = (id) => { $(id).hidden = false; };
const esconder = (id) => { $(id).hidden = true; };

async function api(metodo, url, corpo) {
  const opt = { method: metodo, headers: {} };
  if (corpo !== undefined) { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(corpo); }
  const r = await fetch(url, opt);
  const dados = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(dados.erro || `erro ${r.status}`);
  return dados;
}

// ---------- navegação entre telas ----------
function irPara(view) {
  ['view-login', 'view-lista', 'view-form'].forEach(esconder);
  mostrar(view);
  $('btn-logout').hidden = (view === 'view-login');
}

// ---------- sessão ----------
async function iniciar() {
  try { META = await api('GET', '/api/meta'); } catch (_) { /* não logado ainda */ }
  const { logado } = await api('GET', '/api/sessao');
  if (logado) { await abrirLista(); } else { irPara('view-login'); }
}

$('form-login').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('login-erro').textContent = '';
  try {
    await api('POST', '/api/login', { senha: $('login-senha').value });
    META = await api('GET', '/api/meta');
    await abrirLista();
  } catch (err) { $('login-erro').textContent = err.message; }
});

$('btn-logout').addEventListener('click', async () => {
  await api('POST', '/api/logout');
  $('login-senha').value = '';
  irPara('view-login');
});

// ---------- lista ----------
async function abrirLista() {
  irPara('view-lista');
  const clientes = await api('GET', '/api/clientes');
  const grid = $('lista-clientes');
  grid.innerHTML = '';
  if (!clientes.length) { grid.innerHTML = '<p>Nenhum cliente ainda. Clique em “Novo cliente”.</p>'; return; }
  for (const c of clientes) {
    const card = document.createElement('div');
    card.className = 'card cliente';
    card.innerHTML = `
      <h3>${esc(c.nome)}</h3>
      <p class="meta">slug: <b>${esc(c.slug)}</b> · porta: ${esc(c.porta || '?')} · ${esc(c.tema || '?')}</p>
      ${c.erro ? `<p class="erro">⚠ ${esc(c.erro)}</p>` : ''}
      <div class="prof-acoes">
        <button data-editar="${esc(c.slug)}">Editar</button>
        <button class="secundario" data-aplicar="${esc(c.slug)}">Aplicar</button>
      </div>`;
    grid.appendChild(card);
  }
  grid.querySelectorAll('[data-editar]').forEach((b) =>
    b.addEventListener('click', () => abrirEdicao(b.dataset.editar)));
  grid.querySelectorAll('[data-aplicar]').forEach((b) =>
    b.addEventListener('click', () => aplicar(b.dataset.aplicar)));
}

$('btn-novo').addEventListener('click', abrirCriacao);
$('btn-voltar').addEventListener('click', abrirLista);

// ---------- preencher selects ----------
function preencherSelects() {
  $('e-tema').innerHTML = META.temas.map((t) => `<option>${t}</option>`).join('');
  $('e-perfil').innerHTML = META.perfis.map((p) => `<option>${p}</option>`).join('');
}

// ---------- abrir edição ----------
async function abrirEdicao(slug) {
  modoCriar = false;
  slugAtual = slug;
  preencherSelects();
  $('fs-criar').hidden = true;
  $('form-titulo').textContent = `Editar: ${slug}`;
  const { dados, env } = await api('GET', `/api/clientes/${slug}`);
  preencherForm(dados, env);
  irPara('view-form');
}

// ---------- abrir criação ----------
function abrirCriacao() {
  modoCriar = true;
  slugAtual = null;
  preencherSelects();
  $('fs-criar').hidden = false;
  $('form-titulo').textContent = 'Novo cliente';
  // valores em branco / padrões razoáveis
  preencherForm({
    negocio: { nome: '', subtitulo: '', cidade: '', telefone: '', telegram_chat_id: '', calendar_central: '', permitir_dois_servicos: false },
    mensagens: {},
    profissionais: [vazioProf()],
  }, {
    EXPEDIENTE_INICIO: '9', EXPEDIENTE_FIM: '19', FOLGAS: '0', SLOT_STEP_MIN: '30',
    JANELA_DIAS: '30', ANTECEDENCIA_MIN: '60', LEMBRETE_VESPERA_HORA: '21',
    CORS_ORIGIN: '', LANDING_URL: '', WHATSAPP_INSTANCE: '',
  });
  $('c-slug').value = '';
  $('c-porta').value = '';
  irPara('view-form');
}

function vazioProf() {
  return { nome: '', calendar_id: '', foto_url: '', telegram_chat_id: '', subject_email: null, servicos: [] };
}

// ---------- preencher o formulário a partir dos dados ----------
function preencherForm(dados, env) {
  const neg = dados.negocio || {};
  $('n-nome').value = neg.nome || '';
  $('n-subtitulo').value = neg.subtitulo || '';
  $('n-cidade').value = neg.cidade || '';
  $('n-telefone').value = neg.telefone || '';
  $('n-telegram').value = neg.telegram_chat_id || '';
  $('n-central').value = neg.calendar_central || '';
  $('n-whatsapp-aviso').value = neg.whatsapp_aviso || '';
  $('n-whatsapp-contato').value = neg.whatsapp_contato || '';
  $('n-dois-servicos').checked = !!neg.permitir_dois_servicos;

  $('e-tema').value = env.TEMA || META.temas[0];
  $('e-perfil').value = env.PERFIL_PROFISSIONAL || META.perfis[0];
  $('e-exp-ini').value = env.EXPEDIENTE_INICIO || '';
  $('e-exp-fim').value = env.EXPEDIENTE_FIM || '';
  $('e-folgas').value = env.FOLGAS || '';
  $('e-slot').value = env.SLOT_STEP_MIN || '';
  $('e-janela').value = env.JANELA_DIAS || '';
  $('e-antecedencia').value = env.ANTECEDENCIA_MIN || '';
  $('e-vespera').value = env.LEMBRETE_VESPERA_HORA || '';
  $('e-instancia').value = env.WHATSAPP_INSTANCE || '';
  $('e-modo').value = (env.WHATSAPP_MODE || 'proprio').toLowerCase();
  $('e-inst-central').value = env.WHATSAPP_INSTANCE_CENTRAL || '';
  $('e-inst-avisos').value = env.WHATSAPP_INSTANCE_AVISOS || '';
  $('e-prefixo-nome').checked = String(env.WHATSAPP_PREFIXO_NOME).toLowerCase() === 'true';
  $('e-prefixo-label').value = env.WHATSAPP_PREFIXO_LABEL || '';
  $('e-cors').value = env.CORS_ORIGIN || '';
  $('e-landing').value = env.LANDING_URL || '';

  // profissionais
  $('profissionais').innerHTML = '';
  // OBS: usar (p) => addProfDOM(p) — passar addProfDOM direto faria o forEach mandar o
  // índice como 2º argumento (depoisDe), quebrando a partir do 2º profissional.
  (dados.profissionais && dados.profissionais.length ? dados.profissionais : [vazioProf()])
    .forEach((p) => addProfDOM(p));

  // mensagens
  const msgWrap = $('mensagens');
  msgWrap.innerHTML = '';
  const msgs = dados.mensagens || {};
  for (const tipo of TIPOS_MSG) {
    const v = msgs[tipo];
    const texto = Array.isArray(v) ? v.join('\n') : (v || '');
    const bloco = document.createElement('label');
    bloco.innerHTML = `${tipo}<textarea data-msg="${tipo}" rows="2"></textarea>`;
    bloco.querySelector('textarea').value = texto;
    msgWrap.appendChild(bloco);
  }
}

// ---------- profissionais (DOM dinâmico) ----------
// Lê um card de profissional e devolve o objeto correspondente (usado ao salvar e ao duplicar).
function lerProfDOM(el) {
  const servicos = [];
  el.querySelectorAll('.serv').forEach((s) => {
    const nome = s.querySelector('.s-nome').value.trim();
    if (!nome) return;
    servicos.push({
      nome,
      duracao_min: Number(s.querySelector('.s-duracao').value) || 0,
      valor: Number(s.querySelector('.s-valor').value) || 0,
    });
  });
  return {
    nome: el.querySelector('.p-nome').value.trim(),
    calendar_id: el.querySelector('.p-calendar').value.trim(),
    subject_email: el._subjectEmail ?? null,
    foto_url: el.querySelector('.p-foto').value.trim(),
    telegram_chat_id: el.querySelector('.p-telegram').value.trim(),
    servicos,
  };
}

function addProfDOM(prof, depoisDe) {
  const tpl = $('tpl-prof').content.cloneNode(true);
  const el = tpl.querySelector('.prof');
  el.querySelector('.p-nome').value = prof.nome || '';
  el.querySelector('.p-calendar').value = prof.calendar_id || '';
  el.querySelector('.p-foto').value = prof.foto_url || '';
  el.querySelector('.p-telegram').value = prof.telegram_chat_id || '';
  el._subjectEmail = prof.subject_email ?? null; // preservado, não editável na UI

  const servWrap = el.querySelector('.servicos');
  (prof.servicos && prof.servicos.length ? prof.servicos : []).forEach((s) => addServDOM(servWrap, s));

  el.querySelector('.p-add-serv').addEventListener('click', () => addServDOM(servWrap, {}));
  el.querySelector('.p-remover').addEventListener('click', () => el.remove());
  el.querySelector('.p-duplicar').addEventListener('click', () => {
    // copia os serviços e os campos atuais; limpa o que é exclusivo de cada profissional
    const copia = lerProfDOM(el);
    copia.nome = copia.nome ? `${copia.nome} (cópia)` : '';
    copia.calendar_id = '';      // cada profissional precisa da PRÓPRIA agenda Google (§9.4)
    copia.telegram_chat_id = '';
    copia.foto_url = '';
    addProfDOM(copia, el);
  });

  if (depoisDe) depoisDe.after(el);
  else $('profissionais').appendChild(el);
}

function addServDOM(wrap, serv) {
  const tpl = $('tpl-serv').content.cloneNode(true);
  const el = tpl.querySelector('.serv');
  el.querySelector('.s-nome').value = serv.nome || '';
  el.querySelector('.s-duracao').value = serv.duracao_min ?? '';
  el.querySelector('.s-valor').value = serv.valor ?? '';
  el.querySelector('.s-remover').addEventListener('click', () => el.remove());
  wrap.appendChild(el);
}

$('add-prof').addEventListener('click', () => addProfDOM(vazioProf()));

// ---------- montar o objeto a partir do formulário ----------
function montarDados() {
  const dados = {
    negocio: {
      nome: $('n-nome').value.trim(),
      subtitulo: $('n-subtitulo').value.trim(),
      cidade: $('n-cidade').value.trim(),
      telefone: $('n-telefone').value.trim(),
      telegram_chat_id: $('n-telegram').value.trim(),
      calendar_central: $('n-central').value.trim(),
      whatsapp_contato: $('n-whatsapp-contato').value.trim(),
      whatsapp_aviso: $('n-whatsapp-aviso').value.trim(),
      permitir_dois_servicos: $('n-dois-servicos').checked,
    },
    mensagens: {},
    profissionais: [],
  };

  document.querySelectorAll('#profissionais .prof').forEach((el) => {
    dados.profissionais.push(lerProfDOM(el));
  });

  document.querySelectorAll('#mensagens textarea').forEach((t) => {
    const linhas = t.value.split('\n').map((l) => l.trim()).filter(Boolean);
    if (linhas.length === 1) dados.mensagens[t.dataset.msg] = linhas[0];
    else if (linhas.length > 1) dados.mensagens[t.dataset.msg] = linhas;
  });

  return dados;
}

function montarEnv() {
  return {
    TEMA: $('e-tema').value,
    PERFIL_PROFISSIONAL: $('e-perfil').value,
    EXPEDIENTE_INICIO: $('e-exp-ini').value,
    EXPEDIENTE_FIM: $('e-exp-fim').value,
    FOLGAS: $('e-folgas').value,
    SLOT_STEP_MIN: $('e-slot').value,
    JANELA_DIAS: $('e-janela').value,
    ANTECEDENCIA_MIN: $('e-antecedencia').value,
    LEMBRETE_VESPERA_HORA: $('e-vespera').value,
    WHATSAPP_INSTANCE: $('e-instancia').value.trim(),
    WHATSAPP_MODE: $('e-modo').value,
    WHATSAPP_INSTANCE_CENTRAL: $('e-inst-central').value.trim(),
    WHATSAPP_PREFIXO_NOME: $('e-prefixo-nome').checked ? 'true' : 'false',
    WHATSAPP_PREFIXO_LABEL: $('e-prefixo-label').value.trim(),
    WHATSAPP_INSTANCE_AVISOS: $('e-inst-avisos').value.trim(),
    CORS_ORIGIN: $('e-cors').value.trim(),
    LANDING_URL: $('e-landing').value.trim(),
    PORTA_EXTERNA: modoCriar ? $('c-porta').value : undefined,
  };
}

// ---------- salvar ----------
async function salvar() {
  const dados = montarDados();
  const env = montarEnv();
  if (modoCriar) {
    const slug = $('c-slug').value.trim();
    await api('POST', '/api/clientes', {
      slug, porta: $('c-porta').value, tema: env.TEMA, perfil: env.PERFIL_PROFISSIONAL, dados,
    });
    // aplica os demais campos do .env (expediente, urls, instância…)
    await api('PUT', `/api/clientes/${slug}`, { dados, env });
    slugAtual = slug;
    modoCriar = false;
    $('fs-criar').hidden = true;
    $('form-titulo').textContent = `Editar: ${slug}`;
  } else {
    await api('PUT', `/api/clientes/${slugAtual}`, { dados, env });
  }
  return slugAtual;
}

$('form-cliente').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('form-erro').textContent = '';
  try { await salvar(); await abrirLista(); }
  catch (err) { $('form-erro').textContent = err.message; }
});

$('btn-salvar-aplicar').addEventListener('click', async () => {
  $('form-erro').textContent = '';
  try { const slug = await salvar(); await aplicar(slug); }
  catch (err) { $('form-erro').textContent = err.message; }
});

// ---------- aplicar ----------
async function aplicar(slug) {
  mostrar('modal-log');
  $('log-conteudo').textContent = `Aplicando "${slug}"… (pode levar alguns segundos)`;
  try {
    const { log } = await api('POST', `/api/clientes/${slug}/aplicar`);
    $('log-conteudo').textContent = log;
  } catch (err) {
    $('log-conteudo').textContent = 'ERRO:\n' + err.message;
  }
}
$('btn-fecha-log').addEventListener('click', () => esconder('modal-log'));

// ---------- util ----------
function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

iniciar();
