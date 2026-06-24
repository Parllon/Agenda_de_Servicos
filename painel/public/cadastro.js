'use strict';

// ── Estado global ────────────────────────────────────────────────
const S = {
  porta: null,
  slug: '',
  tema: 'tema_1',
  perfil: 'profissional',
  negocio: { nome: '', subtitulo: '', cidade: '', rede_social: '', whatsapp_aviso: '' },
  profissionais: [],   // [{ nome, calendar_id, servicos: [{nome,duracao_min,valor}] }]
  whatsapp: {
    mode: 'central',
    instance_proprio: '',
    instance_central: 'agendamento',
    prefixo_nome: true,
    prefixo_label: '',
  },
  horarios: { inicio: 9, fim: 19, folgas: [0], slot: 30, janela: 30 },
};

// Steps da navegação (excluindo login/aplicando/sucesso)
const STEPS      = ['step-negocio', 'step-visual', 'step-profs', 'step-whatsapp', 'step-horarios', 'step-revisao'];
const STEP_LABEL = ['Negócio', 'Visual', 'Profissionais', 'WhatsApp', 'Horários', 'Revisão'];
let currentStep  = 0;

// ── Dados dos temas para os cards visuais ────────────────────────
const TEMAS_DATA = [
  { id: 'tema_1', nome: 'Feminino Clássico',  desc: 'Manicure · Nail Designer',        bg: 'rgb(251,246,240)', acc: 'rgb(92,35,48)'   },
  { id: 'tema_2', nome: 'Masculino Clássico', desc: 'Barbearia Tradicional',            bg: 'rgb(18,17,16)',    acc: 'rgb(198,160,74)' },
  { id: 'tema_3', nome: 'Spa & Estética',     desc: 'Spa · Massagem · Estética',        bg: 'rgb(242,248,244)', acc: 'rgb(38,110,89)'  },
  { id: 'tema_4', nome: 'Hair Salon',         desc: 'Cabeleireiro · Coloração',         bg: 'rgb(252,246,250)', acc: 'rgb(200,52,98)'  },
  { id: 'tema_5', nome: 'Beauty Studio',      desc: 'Lash · Sobrancelha · Micropig',   bg: 'rgb(252,247,240)', acc: 'rgb(148,102,62)' },
  { id: 'tema_6', nome: 'Ink & Art',          desc: 'Tatuagem · Piercing',              bg: 'rgb(14,13,12)',    acc: 'rgb(210,45,45)'  },
  { id: 'tema_7', nome: 'Luxo Premium',       desc: 'Salão Premium · Clínica',          bg: 'rgb(252,250,244)', acc: 'rgb(172,140,82)' },
  { id: 'tema_8', nome: 'Minimalista',        desc: 'Estúdio · Barbearia Moderna',      bg: 'rgb(250,250,250)', acc: 'rgb(24,24,27)'   },
];

const PERFIS_DATA = [
  { id: 'profissional', label: 'Profissional' },
  { id: 'barbeiro',     label: 'Barbeiro'     },
  { id: 'terapeuta',    label: 'Terapeuta'    },
  { id: 'cabeleireiro', label: 'Cabeleireiro' },
  { id: 'designer',     label: 'Designer'     },
  { id: 'tatuador',     label: 'Tatuador'     },
  { id: 'especialista', label: 'Especialista' },
];

const DIAS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

// ── Utilidades ───────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
}

function slugify(txt) {
  return txt.toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '');
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function api(method, path, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin' };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const r = await fetch(path, opts);
  const json = await r.json();
  if (!r.ok) throw new Error(json.erro || 'Erro desconhecido');
  return json;
}

// ── Inicialização ─────────────────────────────────────────────────
async function init() {
  buildTemaGrid();
  buildPerfilChips();
  buildHorariosStep();
  setupWAListeners();
  setupProfListeners();

  const sessao = await api('GET', '/api/sessao');
  if (sessao.logado) {
    buscarPorta();
    showWizard();
  } else {
    showStep('step-login');
  }
}

async function buscarPorta() {
  try { const r = await api('GET', '/api/next-porta'); S.porta = r.porta; }
  catch { S.porta = 8096; }
}

// ── Login ─────────────────────────────────────────────────────────
$('form-login').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('login-erro').textContent = '';
  try {
    await api('POST', '/api/login', { senha: $('login-senha').value });
    buscarPorta();
    showWizard();
  } catch {
    $('login-erro').textContent = 'Senha incorreta.';
  }
});

// ── Navegação entre steps ─────────────────────────────────────────
function showStep(id) {
  document.querySelectorAll('.step').forEach((s) => s.classList.remove('active'));
  const el = $(id);
  el.removeAttribute('hidden');
  el.classList.add('active');
}

function showWizard() {
  $('progress-bar').hidden = false;
  $('step-header').hidden = false;
  $('footer-nav').hidden = false;
  goToStep(0);
}

function goToStep(i) {
  currentStep = i;
  const pct = ((i + 1) / STEPS.length) * 100;
  $('progress-fill').style.width = pct + '%';
  $('step-label').textContent = STEP_LABEL[i];
  $('step-counter').textContent = `${i + 1} / ${STEPS.length}`;
  showStep(STEPS[i]);
  $('btn-back').hidden = i === 0;
  $('btn-next').textContent = i === STEPS.length - 1 ? 'Criar e Ativar →' : 'Próximo →';
  if (i === STEPS.length - 1) buildRevisao();
  window.scrollTo(0, 0);
}

$('btn-next').addEventListener('click', () => {
  if (!validateStep(currentStep)) return;
  if (currentStep < STEPS.length - 1) goToStep(currentStep + 1);
  else criarCliente();
});

$('btn-back').addEventListener('click', () => {
  if (currentStep > 0) goToStep(currentStep - 1);
});

// ── Validação por step ────────────────────────────────────────────
function validateStep(i) {
  if (i === 0) return validateNegocio();
  if (i === 2) return validateProfs();
  return true;
}

function validateNegocio() {
  const nome  = $('n-nome').value.trim();
  const slug  = $('n-slug').value.trim();
  const cidade = $('n-cidade').value.trim();
  if (!nome)  { alert('Informe o nome do salão.'); return false; }
  if (!slug)  { alert('Informe o subdomínio.'); return false; }
  if (!/^[a-z0-9._-]+$/.test(slug)) {
    alert('Slug inválido — use só letras minúsculas, números, ponto, hífen ou _.');
    return false;
  }
  if (!cidade) { alert('Informe a cidade.'); return false; }
  S.negocio.nome      = nome;
  S.negocio.subtitulo = $('n-subtitulo').value.trim();
  S.negocio.cidade    = cidade;
  S.negocio.rede_social = $('n-redesocial').value.trim();
  S.slug              = slug;
  return true;
}

function validateProfs() {
  if (S.profissionais.length === 0) { alert('Adicione pelo menos 1 profissional.'); return false; }
  for (const p of S.profissionais) {
    if (!p.nome)        { alert('Informe o nome de todos os profissionais.'); return false; }
    if (!p.calendar_id) { alert(`Informe o e-mail do Google Calendar de "${p.nome || 'um profissional'}".`); return false; }
    if (!p.servicos.length) { alert(`Adicione ao menos 1 serviço para "${p.nome}".`); return false; }
    for (const s of p.servicos) {
      if (!s.nome) { alert(`Informe o nome de todos os serviços de "${p.nome}".`); return false; }
    }
  }
  return true;
}

// ── Step 1: Negócio ───────────────────────────────────────────────
$('n-nome').addEventListener('input', () => {
  if (!$('n-slug').dataset.edited) {
    $('n-slug').value = slugify($('n-nome').value);
    updateSlugPreview();
  }
});
$('n-slug').addEventListener('input', () => {
  $('n-slug').dataset.edited = '1';
  updateSlugPreview();
});
function updateSlugPreview() {
  const s = $('n-slug').value.trim();
  $('slug-preview').textContent = s ? `→ ${s}.agendamentos.app.br` : '';
}

// ── Step 2: Visual ────────────────────────────────────────────────
function buildTemaGrid() {
  const grid = $('tema-grid');
  TEMAS_DATA.forEach((t) => {
    const card = document.createElement('div');
    card.className = `tema-card${t.id === S.tema ? ' selected' : ''}`;
    card.innerHTML =
      `<div class="tema-swatch">` +
      `  <div class="tema-bg" style="background:${t.bg}"></div>` +
      `  <div class="tema-acc" style="background:${t.acc}"></div>` +
      `</div>` +
      `<div class="tema-nome">${t.nome}</div>` +
      `<div class="tema-desc">${t.desc}</div>`;
    card.addEventListener('click', () => {
      S.tema = t.id;
      grid.querySelectorAll('.tema-card').forEach((c) => c.classList.remove('selected'));
      card.classList.add('selected');
    });
    grid.appendChild(card);
  });
}

function buildPerfilChips() {
  const container = $('perfil-chips');
  PERFIS_DATA.forEach((p) => {
    const chip = document.createElement('div');
    chip.className = `chip${p.id === S.perfil ? ' selected' : ''}`;
    chip.textContent = p.label;
    chip.addEventListener('click', () => {
      S.perfil = p.id;
      container.querySelectorAll('.chip').forEach((c) => c.classList.remove('selected'));
      chip.classList.add('selected');
    });
    container.appendChild(chip);
  });
}

// ── Step 3: Profissionais ─────────────────────────────────────────
function setupProfListeners() {
  const lista = $('lista-profs');

  // Delegação de eventos: inputs (mantém estado sincronizado)
  lista.addEventListener('input', (e) => {
    const profCard = e.target.closest('.prof-card');
    if (!profCard) return;
    const pi = parseInt(profCard.dataset.pi, 10);
    const servItem = e.target.closest('.serv-item');

    if (servItem) {
      const si = parseInt(servItem.dataset.si, 10);
      if (e.target.matches('.s-nome'))  S.profissionais[pi].servicos[si].nome       = e.target.value;
      if (e.target.matches('.s-valor')) S.profissionais[pi].servicos[si].valor       = parseFloat(e.target.value) || 0;
    } else {
      if (e.target.matches('.p-nome'))     { S.profissionais[pi].nome = e.target.value; }
      if (e.target.matches('.p-calendar')) { S.profissionais[pi].calendar_id = e.target.value; }
    }
  });

  lista.addEventListener('change', (e) => {
    const profCard = e.target.closest('.prof-card');
    if (!profCard) return;
    const pi = parseInt(profCard.dataset.pi, 10);
    const servItem = e.target.closest('.serv-item');
    if (servItem && e.target.matches('.s-dur')) {
      const si = parseInt(servItem.dataset.si, 10);
      S.profissionais[pi].servicos[si].duracao_min = parseInt(e.target.value, 10);
    }
  });

  // Delegação de eventos: cliques (add/remove)
  lista.addEventListener('click', (e) => {
    const profCard = e.target.closest('.prof-card');
    if (!profCard) return;
    const pi = parseInt(profCard.dataset.pi, 10);

    if (e.target.matches('.btn-remove-prof')) {
      S.profissionais.splice(pi, 1);
      renderProfs();
      return;
    }

    if (e.target.matches('.btn-remove-serv')) {
      const si = parseInt(e.target.closest('.serv-item').dataset.si, 10);
      S.profissionais[pi].servicos.splice(si, 1);
      renderServicos(profCard, pi);
      return;
    }

    if (e.target.matches('.btn-add-serv')) {
      S.profissionais[pi].servicos.push({ nome: '', duracao_min: 60, valor: 0 });
      renderServicos(profCard, pi);
    }
  });

  $('btn-add-prof').addEventListener('click', () => {
    S.profissionais.push({ nome: '', calendar_id: '', servicos: [] });
    renderProfs();
    // Foca no nome do novo profissional
    const cards = lista.querySelectorAll('.prof-card');
    const last  = cards[cards.length - 1];
    if (last) last.querySelector('.p-nome')?.focus();
  });
}

function renderProfs() {
  const lista = $('lista-profs');
  lista.innerHTML = '';
  S.profissionais.forEach((p, i) => {
    const card = document.createElement('div');
    card.className = 'prof-card';
    card.dataset.pi = i;
    card.innerHTML =
      `<div class="prof-header">` +
      `  <span class="prof-num">Profissional ${i + 1}</span>` +
      `  <button type="button" class="btn-remove-prof">Remover</button>` +
      `</div>` +
      `<div class="fields">` +
      `  <label class="field"><span>Nome completo</span>` +
      `    <input type="text" class="p-nome" value="${esc(p.nome)}" placeholder="ex: Maria Silva" /></label>` +
      `  <label class="field"><span>E-mail do Google Calendar</span>` +
      `    <input type="email" class="p-calendar" value="${esc(p.calendar_id)}" placeholder="maria@gmail.com" /></label>` +
      `</div>` +
      `<div class="servicos-list"></div>` +
      `<button type="button" class="btn-add-serv">+ Adicionar serviço</button>`;
    renderServicos(card, i);
    lista.appendChild(card);
  });
}

function renderServicos(profCard, pi) {
  const container = profCard.querySelector('.servicos-list');
  container.innerHTML = '';
  S.profissionais[pi].servicos.forEach((s, si) => {
    const row = document.createElement('div');
    row.className = 'serv-item';
    row.dataset.si = si;
    const durOpts = [30, 45, 60, 90, 120]
      .map((m) => `<option value="${m}"${m === (s.duracao_min || 60) ? ' selected' : ''}>${m} min</option>`)
      .join('');
    row.innerHTML =
      `<div class="serv-nome-row">` +
      `  <input type="text" class="s-nome field" value="${esc(s.nome)}" placeholder="Nome do serviço" style="border:1px solid var(--linha);border-radius:10px;padding:10px 12px;background:#0f1218;color:var(--txt);font-size:15px;width:100%" />` +
      `  <button type="button" class="btn-remove-serv" title="Remover serviço">×</button>` +
      `</div>` +
      `<div class="serv-details-row">` +
      `  <label class="field"><span>Duração</span><select class="s-dur">${durOpts}</select></label>` +
      `  <label class="field"><span>Preço (R$)</span>` +
      `    <input type="number" class="s-valor" value="${s.valor || ''}" placeholder="50" step="5" inputmode="decimal" /></label>` +
      `</div>`;
    container.appendChild(row);
  });
}

// ── Step 4: WhatsApp ──────────────────────────────────────────────
function setupWAListeners() {
  document.querySelectorAll('input[name="wmode"]').forEach((radio) => {
    radio.addEventListener('change', () => {
      const mode = document.querySelector('input[name="wmode"]:checked').value;
      S.whatsapp.mode = mode;
      $('wa-central').hidden = mode !== 'central';
      $('wa-proprio').hidden = mode !== 'proprio';
      $('card-central').classList.toggle('checked', mode === 'central');
      $('card-proprio').classList.toggle('checked', mode === 'proprio');
    });
  });
  $('wa-inst-central').addEventListener('input', (e) => { S.whatsapp.instance_central = e.target.value; });
  $('wa-inst-proprio').addEventListener('input', (e) => { S.whatsapp.instance_proprio  = e.target.value; });
  $('wa-prefixo').addEventListener('change', (e) => {
    S.whatsapp.prefixo_nome = e.target.checked;
    $('wa-label-field').hidden = !e.target.checked;
  });
  $('wa-label').addEventListener('input',  (e) => { S.whatsapp.prefixo_label = e.target.value; });
  $('wa-aviso').addEventListener('input',  (e) => { const v = e.target.value.trim(); S.negocio.whatsapp_aviso = v ? '55' + v : ''; });
}

// ── Step 5: Horários ──────────────────────────────────────────────
function buildHorariosStep() {
  // Selects de horário
  ['h-ini', 'h-fim'].forEach((id) => {
    const sel = $(id);
    const def = id === 'h-ini' ? 9 : 19;
    for (let h = 6; h <= 23; h++) {
      const opt = document.createElement('option');
      opt.value = h;
      opt.textContent = `${h}:00`;
      if (h === def) opt.selected = true;
      sel.appendChild(opt);
    }
    sel.addEventListener('change', (e) => {
      S.horarios[id === 'h-ini' ? 'inicio' : 'fim'] = parseInt(e.target.value, 10);
    });
  });

  // Folgas
  const fgGrid = $('folgas-grid');
  DIAS.forEach((d, i) => {
    const chip = document.createElement('div');
    chip.className = `folga-chip${S.horarios.folgas.includes(i) ? ' on' : ''}`;
    chip.textContent = d;
    chip.addEventListener('click', () => {
      const idx = S.horarios.folgas.indexOf(i);
      if (idx >= 0) S.horarios.folgas.splice(idx, 1);
      else S.horarios.folgas.push(i);
      chip.classList.toggle('on', S.horarios.folgas.includes(i));
    });
    fgGrid.appendChild(chip);
  });

  // Slots
  const slotC = $('slot-chips');
  [30, 45, 60, 90].forEach((m) => {
    const chip = document.createElement('div');
    chip.className = `slot-chip${S.horarios.slot === m ? ' on' : ''}`;
    chip.textContent = `${m} min`;
    chip.addEventListener('click', () => {
      S.horarios.slot = m;
      slotC.querySelectorAll('.slot-chip').forEach((c) => c.classList.remove('on'));
      chip.classList.add('on');
    });
    slotC.appendChild(chip);
  });

  // Janela
  $('h-janela').addEventListener('change', (e) => { S.horarios.janela = parseInt(e.target.value, 10); });
}

// ── Step 6: Revisão ───────────────────────────────────────────────
function buildRevisao() {
  const c = $('revisao-cards');
  const tema  = TEMAS_DATA.find((t) => t.id === S.tema);
  const perfil = PERFIS_DATA.find((p) => p.id === S.perfil);

  let html = `<div class="rev-card">
    <div class="rev-title">Negócio</div>
    <div class="rev-row"><span>Nome</span><span>${esc(S.negocio.nome)}</span></div>
    ${S.negocio.subtitulo ? `<div class="rev-row"><span>Subtítulo</span><span>${esc(S.negocio.subtitulo)}</span></div>` : ''}
    <div class="rev-row"><span>Cidade</span><span>${esc(S.negocio.cidade)}</span></div>
    ${S.negocio.rede_social ? `<div class="rev-row"><span>Rede social</span><span>${esc(S.negocio.rede_social)}</span></div>` : ''}
    <div class="rev-row"><span>Slug</span><span>${esc(S.slug)}.agendamentos.app.br</span></div>
    <div class="rev-row"><span>Tema</span><span>${tema?.nome}</span></div>
    <div class="rev-row"><span>Perfil</span><span>${perfil?.label}</span></div>
  </div>`;

  html += `<div class="rev-card"><div class="rev-title">Profissionais</div>`;
  S.profissionais.forEach((p) => {
    html += `<div class="rev-prof">
      <div class="rev-prof-nome">${esc(p.nome)}</div>
      <div class="rev-email">${esc(p.calendar_id)}</div>
      ${p.servicos.map((s) => `<div class="rev-serv">• ${esc(s.nome)} · ${s.duracao_min} min · R$ ${s.valor}</div>`).join('')}
    </div>`;
  });
  html += `</div>`;

  const modoLabel = S.whatsapp.mode === 'central' ? 'Central SlotMe' : 'Número próprio';
  const instancia = S.whatsapp.mode === 'central' ? S.whatsapp.instance_central : S.whatsapp.instance_proprio;
  html += `<div class="rev-card">
    <div class="rev-title">WhatsApp</div>
    <div class="rev-row"><span>Modo</span><span>${modoLabel}</span></div>
    <div class="rev-row"><span>Instância</span><span>${esc(instancia)}</span></div>
    ${S.negocio.whatsapp_aviso ? `<div class="rev-row"><span>Aviso</span><span>${esc(S.negocio.whatsapp_aviso)}</span></div>` : ''}
  </div>`;

  const folgasNomes = S.horarios.folgas.sort((a, b) => a - b).map((i) => DIAS[i]).join(', ');
  html += `<div class="rev-card">
    <div class="rev-title">Horários</div>
    <div class="rev-row"><span>Expediente</span><span>${S.horarios.inicio}h – ${S.horarios.fim}h</span></div>
    <div class="rev-row"><span>Folgas</span><span>${folgasNomes || 'Nenhuma'}</span></div>
    <div class="rev-row"><span>Intervalo</span><span>${S.horarios.slot} min</span></div>
    <div class="rev-row"><span>Janela</span><span>${S.horarios.janela} dias</span></div>
  </div>`;

  c.innerHTML = html;
}

// ── Criar cliente ─────────────────────────────────────────────────
async function criarCliente() {
  $('footer-nav').hidden = true;
  $('step-header').hidden = true;
  $('progress-bar').hidden = true;
  showStep('step-aplicando');

  const slug  = S.slug;
  const porta = S.porta;
  const url   = `https://${slug}.agendamentos.app.br`;

  function setFase(id, estado) {
    const el = $(id);
    el.classList.remove('done', 'ativa', 'falhou');
    if (estado) el.classList.add(estado);
  }

  const dados = {
    negocio: {
      nome:              S.negocio.nome,
      subtitulo:         S.negocio.subtitulo,
      cidade:            S.negocio.cidade,
      rede_social:       S.negocio.rede_social || '',
      whatsapp_contato:  '',
      whatsapp_aviso:    S.negocio.whatsapp_aviso || '',
    },
    profissionais: S.profissionais.map((p, i) => ({
      id:            i + 1,
      nome:          p.nome,
      calendar_id:   p.calendar_id,
      subject_email: p.calendar_id,
      foto_url:      '',
      telegram_chat_id: '',
      servicos:      p.servicos.map((s) => ({
        nome:        s.nome,
        duracao_min: Number(s.duracao_min) || 60,
        valor:       Number(s.valor)       || 0,
      })),
    })),
  };

  const envExtra = {
    EXPEDIENTE_INICIO:       String(S.horarios.inicio),
    EXPEDIENTE_FIM:          String(S.horarios.fim),
    FOLGAS:                  S.horarios.folgas.join(','),
    SLOT_STEP_MIN:           String(S.horarios.slot),
    JANELA_DIAS:             String(S.horarios.janela),
    WHATSAPP_MODE:           S.whatsapp.mode,
    WHATSAPP_INSTANCE:       S.whatsapp.mode === 'proprio'
                               ? S.whatsapp.instance_proprio
                               : S.whatsapp.instance_central,
    WHATSAPP_INSTANCE_CENTRAL: S.whatsapp.instance_central,
    WHATSAPP_PREFIXO_NOME:   S.whatsapp.prefixo_nome ? 'true' : 'false',
    WHATSAPP_PREFIXO_LABEL:  S.whatsapp.prefixo_label || '',
    CORS_ORIGIN:             url,
    LANDING_URL:             url,
  };

  // ── Fase 1: criar config ─────────────────────────────
  setFase('fase-config', 'ativa');
  try {
    await api('POST', '/api/clientes', { slug, porta, tema: S.tema, perfil: S.perfil, dados });
    await api('PUT', `/api/clientes/${slug}`, { dados, env: envExtra });
    setFase('fase-config', 'done');
  } catch (e) {
    setFase('fase-config', 'falhou');
    $('apply-titulo').textContent = 'Erro: ' + e.message;
    return;
  }

  // ── Fase 2: Docker ───────────────────────────────────
  setFase('fase-docker', 'ativa');
  let dockerOk = false;
  try {
    await api('POST', `/api/clientes/${slug}/aplicar`);
    dockerOk = true;
    setFase('fase-docker', 'done');
  } catch (e) {
    setFase('fase-docker', 'falhou');
    // Continua mesmo assim para tentar o DNS
  }

  // ── Fase 3: Cloudflare DNS ───────────────────────────
  setFase('fase-dns', 'ativa');
  let cf = { dns: false, config: false, reload: false, avisos: [] };
  try {
    cf = await api('POST', `/api/clientes/${slug}/cloudflare`, { porta });
    setFase('fase-dns', cf.dns ? 'done' : 'falhou');
  } catch (e) {
    setFase('fase-dns', 'falhou');
    cf.avisos.push(e.message);
  }

  // ── Fase 4: aguarda containers subirem (docker roda em background) ──
  setFase('fase-final', 'ativa');
  $('apply-titulo').textContent = 'Aguardando containers...';
  await sleep(15000);
  setFase('fase-final', 'done');

  showSucesso(slug, url, cf, dockerOk);
}

const BOT_EMAIL = 'calendar-bot@agenda-de-servicos-498211.iam.gserviceaccount.com';

function showSucesso(slug, url, cf, dockerOk) {
  $('link-cliente').href    = url;
  $('link-cliente').textContent = url;

  const chips = $('status-chips');
  chips.innerHTML = '';
  addChip(chips, 'Config',     true);
  addChip(chips, 'Docker',     dockerOk);
  addChip(chips, 'DNS',        cf.dns);
  addChip(chips, 'CF Reload',  cf.reload);

  const avisos = [];
  if (!dockerOk) avisos.push('Containers não subiram — verifique o log no painel.');
  if (cf.avisos.length) avisos.push(...cf.avisos);

  if (avisos.length) {
    $('aviso-reload').hidden = false;
    $('aviso-reload').textContent = avisos.join('\n');
  } else {
    $('aviso-reload').hidden = true;
  }

  // Lista de profissionais para compartilhamento de agenda
  $('setup-profs').innerHTML = S.profissionais.map((p) =>
    `<div class="setup-prof-row">
      <span class="setup-prof-nome">${esc(p.nome)}</span>
      <span class="setup-prof-cal">${esc(p.calendar_id)}</span>
    </div>`
  ).join('');

  showStep('step-sucesso');
  $('footer-nav').hidden = true;
}

function copiarBotEmail() {
  navigator.clipboard.writeText(BOT_EMAIL).then(() => {
    const btn = $('btn-copy-bot-email');
    btn.textContent = 'Copiado!';
    setTimeout(() => { btn.textContent = 'Copiar e-mail'; }, 2000);
  });
}

function addChip(container, label, ok) {
  const chip = document.createElement('div');
  chip.className = `status-chip ${ok ? 'ok' : 'fail'}`;
  chip.textContent = `${ok ? '✓' : '✗'} ${label}`;
  container.appendChild(chip);
}

// ── Cadastrar outro ───────────────────────────────────────────────
$('btn-novo-cliente').addEventListener('click', () => {
  // Reseta estado
  S.porta = null;
  S.slug  = '';
  S.tema  = 'tema_1';
  S.perfil = 'profissional';
  S.negocio = { nome: '', subtitulo: '', cidade: '', rede_social: '', whatsapp_aviso: '' };
  S.profissionais = [];
  S.whatsapp = { mode: 'central', instance_proprio: '', instance_central: 'agendamento', prefixo_nome: true, prefixo_label: '' };
  S.horarios = { inicio: 9, fim: 19, folgas: [0], slot: 30, janela: 30 };

  // Limpa campos
  ['n-nome', 'n-slug', 'n-subtitulo', 'n-cidade', 'n-redesocial'].forEach((id) => { $(id).value = ''; });
  delete $('n-slug').dataset.edited;
  $('slug-preview').textContent = '';
  $('lista-profs').innerHTML = '';
  $('status-chips').innerHTML = '';
  $('aviso-reload').hidden = true;

  // Reset tema/perfil visual
  $('tema-grid').querySelectorAll('.tema-card').forEach((c, i) => c.classList.toggle('selected', i === 0));
  $('perfil-chips').querySelectorAll('.chip').forEach((c, i) => c.classList.toggle('selected', i === 0));

  // Reset WhatsApp
  document.querySelector('input[name="wmode"][value="central"]').checked = true;
  $('card-central').classList.add('checked');
  $('card-proprio').classList.remove('checked');
  $('wa-central').hidden = false;
  $('wa-proprio').hidden = true;
  $('wa-prefixo').checked = true;
  $('wa-label-field').hidden = false;
  $('wa-label').value = '';
  $('wa-aviso').value = '';

  // Reset horários
  $('h-ini').value = 9;
  $('h-fim').value = 19;
  $('folgas-grid').querySelectorAll('.folga-chip').forEach((c, i) => c.classList.toggle('on', i === 0));
  $('slot-chips').querySelectorAll('.slot-chip').forEach((c, i) => c.classList.toggle('on', i === 0));
  $('h-janela').value = 30;

  buscarPorta();
  $('progress-bar').hidden = false;
  $('step-header').hidden  = false;
  $('footer-nav').hidden   = false;
  goToStep(0);
});

// ── Start ─────────────────────────────────────────────────────────
init();
