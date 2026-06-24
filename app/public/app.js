// app.js — lógica do agendamento (estado, calendário, validações, fluxo dos 5 passos).
// Separado do index.html para facilitar manutenção. Comportamento idêntico ao original.

// ===================== CONFIG =====================
const API = ''; // mesma origem (servido pelo Express)

// DDDs válidos no Brasil
const DDDS = new Set([
  11, 12, 13, 14, 15, 16, 17, 18, 19, 21, 22, 24, 27, 28,
  31, 32, 33, 34, 35, 37, 38, 41, 42, 43, 44, 45, 46, 47, 48, 49,
  51, 53, 54, 55, 61, 62, 63, 64, 65, 66, 67, 68, 69,
  71, 73, 74, 75, 77, 79, 81, 82, 83, 84, 85, 86, 87, 88, 89,
  91, 92, 93, 94, 95, 96, 97, 98, 99,
]);

// ===================== ESTADO =====================
const state = {
  passo: 1,
  profissional: null, // {id, nome}
  servicos: [],       // até 2 serviços escolhidos: [{id, nome, duracao_min, valor}]
  horario: null,      // {inicio, fim, label}
  data: null,
  nome: '',
  telefone: '',       // E.164: 55 + DDD + número
  diasDisponiveis: null, // null=sem serviço/falha (tudo clicável) | 'loading' | Set de dias com vaga
};

// ===================== MÉTRICAS (funil) =====================
// ID de sessão único por visita (limpa ao fechar o tab). Usado para rastrear
// onde cada visitante desiste no funil de agendamento.
const SID = (() => {
  let s = sessionStorage.getItem('slotme_sid');
  if (!s) { s = crypto.randomUUID(); sessionStorage.setItem('slotme_sid', s); }
  return s;
})();
function trackEvent(tipo) {
  fetch('/evento', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessaoId: SID, tipo }),
  }).catch(() => {}); // fire-and-forget; nunca bloqueia a UI
}

// Liga a escolha de até 2 serviços (vem do servidor via __CFG; default desligado).
const PERMITIR_DOIS = !!(window.__CFG && window.__CFG.permitirDoisServicos);

// Serviço "efetivo" da marcação: null se nada escolhido; o próprio serviço se for 1;
// ou um combinado (nome "A + B", duração e valor somados) quando houver 2. As rotas
// do back-end recebem só nome/duração/valor, então o combinado funciona direto.
function servicoEfetivo() {
  if (!state.servicos.length) return null;
  if (state.servicos.length === 1) return state.servicos[0];
  return {
    nome: state.servicos.map((s) => s.nome).join(' + '),
    duracao_min: state.servicos.reduce((a, s) => a + s.duracao_min, 0),
    valor: state.servicos.reduce((a, s) => a + s.valor, 0),
  };
}

// ===================== HELPERS =====================
const $ = (id) => document.getElementById(id);
const moeda = (v) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

function mostrarPasso(n) {
  state.passo = n;
  for (let i = 1; i <= 5; i++) $(`view-${i}`).classList.toggle('hidden', i !== n);
  $('view-sucesso').classList.add('hidden');
  $('nav-botoes').classList.remove('hidden');
  // a barra de passos não aparece na tela inicial (passo 1)
  $('stepsNav').classList.toggle('hidden', n === 1);

  // anima a seção visível
  const view = $(`view-${n}`);
  view.classList.remove('step-enter'); void view.offsetWidth; view.classList.add('step-enter');

  // progresso + indicador
  $('progress').style.width = `${n * 20}%`;
  document.querySelectorAll('#steps li').forEach((li) => {
    const s = +li.dataset.s;
    li.classList.toggle('text-wine', s === n);
    li.classList.toggle('font-semibold', s === n);
    // passos anteriores são clicáveis (pra voltar); os demais, não
    li.classList.toggle('cursor-pointer', s < n);
    li.classList.toggle('hover:text-wine', s < n);
  });

  $('btn-voltar').classList.toggle('invisible', n === 1);
  $('btn-avancar').classList.toggle('hidden', n === 5); // passo 5 usa botão próprio
  atualizarAvancar();
}

// habilita "Avançar" conforme o passo
function atualizarAvancar() {
  const ok = {
    1: !!state.profissional,
    2: state.servicos.length >= 1,
    3: !!state.horario,
    4: validarNome().ok && validarTelefone().ok,
    5: true,
  }[state.passo];
  $('btn-avancar').disabled = !ok;
}

// ===================== CARREGAR DADOS =====================
async function carregarProfissionais() {
  const wrap = $('lista-profissionais');
  try {
    const profs = await (await fetch(`${API}/profissionais`)).json();
    wrap.innerHTML = '';
    profs.forEach((p) => {
      const b = document.createElement('button');
      b.className = 'card-pick flex flex-col items-center gap-2.5 p-3 w-28 ' +
                    'rounded-2xl border border-transparent hover:border-wine';

      // molde redondo: a inicial do nome é o fallback padrão
      const inicial = () => {
        const s = document.createElement('span');
        s.className = 'font-display text-wine text-3xl';
        s.textContent = (p.nome || '?').trim()[0] || '?';
        return s;
      };

      const circulo = document.createElement('div');
      circulo.className = 'w-24 h-24 rounded-full overflow-hidden bg-blush/40 ' +
                          'flex items-center justify-center shadow-sm';

      if (p.foto_url) {
        const img = document.createElement('img');
        img.src = p.foto_url;
        img.alt = p.nome;
        img.className = 'w-full h-full object-cover';
        // se a foto não carregar (arquivo faltando / URL quebrada), cai pra inicial
        img.onerror = () => { circulo.innerHTML = ''; circulo.appendChild(inicial()); };
        circulo.appendChild(img);
      } else {
        circulo.appendChild(inicial());
      }

      const nome = document.createElement('span');
      nome.className = 'font-medium text-wineDark text-sm text-center leading-tight';
      nome.textContent = p.nome;

      b.appendChild(circulo);
      b.appendChild(nome);
      b.onclick = () => {
        state.profissional = p;
        state.horario = null; state.diasDisponiveis = null;
        selecionar(wrap, b);
        carregarServicos(p.id); // só os serviços DESTA profissional
        atualizarAvancar();
        trackEvent('profissional_selecionado');
      };
      wrap.appendChild(b);
    });
    // auto-seleciona se houver apenas uma
    if (profs.length === 1) wrap.firstChild.click();
  } catch {
    wrap.innerHTML = `<p class="text-sm text-wine">Não foi possível carregar as profissionais.</p>`;
  }
}

async function carregarServicos(profissionalId) {
  const wrap = $('lista-servicos');
  state.servicos = []; // a lista vai mudar conforme a profissional; zera a seleção anterior
  if (!profissionalId) { wrap.innerHTML = ''; return; }
  wrap.innerHTML = `<p class="text-sm text-clay">Carregando serviços…</p>`;
  try {
    const servs = await (await fetch(`${API}/servicos?profissionalId=${profissionalId}`)).json();
    wrap.innerHTML = '';
    if (!servs.length) {
      wrap.innerHTML = `<p class="text-sm text-clay">Nenhum serviço cadastrado.</p>`;
      return;
    }
    servs.forEach((s) => {
      const b = document.createElement('button');
      b.className = 'card-pick text-left bg-card/70 border border-blush/50 rounded-2xl px-5 py-4 ' +
                    'hover:border-wine flex items-center justify-between';
      b.innerHTML = `
        <span>
          <span class="block font-medium text-wineDark">${s.nome}</span>
          <span class="block text-xs text-clay mt-0.5">${s.duracao_min} min</span>
        </span>
        <span class="font-display text-wine text-lg">${moeda(s.valor)}</span>`;
      b.onclick = () => {
        // mudar a seleção invalida horário/dias (a duração muda)
        state.horario = null; state.diasDisponiveis = null;
        if (PERMITIR_DOIS) {
          alternarServico(wrap, b, s); // até 2; sem auto-avanço (2º é opcional)
          atualizarAvancar();
          if (state.servicos.length >= 1) trackEvent('servico_selecionado');
        } else {
          state.servicos = [s];
          selecionar(wrap, b);
          atualizarAvancar();
          trackEvent('servico_selecionado');
          // avança sozinho pro horário (pequeno respiro pra mostrar o item marcado)
          clearTimeout(autoAvancoTimer);
          autoAvancoTimer = setTimeout(avancar, 200);
        }
      };
      wrap.appendChild(b);
    });
  } catch {
    wrap.innerHTML = `<p class="text-sm text-wine">Não foi possível carregar os serviços.</p>`;
  }
}

async function carregarHorarios() {
  const grade = $('grade-horarios');
  const msg = $('horarios-msg');
  grade.innerHTML = ''; msg.classList.add('hidden');
  state.horario = null; atualizarAvancar();

  const serv = servicoEfetivo();
  if (!state.data || !state.profissional || !serv) return;

  grade.innerHTML = `<p class="col-span-full text-sm text-clay">Buscando horários…</p>`;
  try {
    const url = `${API}/horarios-disponiveis?profissionalId=${state.profissional.id}` +
                `&data=${state.data}&duracaoMin=${serv.duracao_min}`;
    const r = await (await fetch(url)).json();
    grade.innerHTML = '';
    if (!r.horarios || r.horarios.length === 0) {
      msg.textContent = r.motivo || 'Nenhum horário livre nesta data. Tente outro dia.';
      msg.classList.remove('hidden');
      return;
    }
    r.horarios.forEach((h) => {
      const b = document.createElement('button');
      b.className = 'card-pick bg-card/70 border border-blush/50 rounded-xl py-2.5 ' +
                    'text-sm text-wineDark hover:border-wine';
      b.textContent = h.label;
      b.onclick = () => { state.horario = h; selecionar(grade, b); atualizarAvancar(); trackEvent('horario_selecionado'); };
      grade.appendChild(b);
    });
  } catch {
    grade.innerHTML = `<p class="col-span-full text-sm text-wine">Erro ao buscar horários.</p>`;
  }
}

// realça o item selecionado dentro de um container (borda na cor do botão)
function selecionar(container, el) {
  [...container.children].forEach((c) => c.classList.remove('card-sel'));
  el.classList.add('card-sel');
}

// Modo "até 2 serviços": alterna o serviço clicado em state.servicos (máx. 2).
// Clicar num já marcado o remove; tentar um 3º é ignorado. O destaque (card-sel)
// reflete a pertinência ao conjunto.
function alternarServico(container, el, s) {
  const i = state.servicos.indexOf(s);
  if (i >= 0) {
    state.servicos.splice(i, 1);
    el.classList.remove('card-sel');
  } else if (state.servicos.length < 2) {
    state.servicos.push(s);
    el.classList.add('card-sel');
  }
  // (se já há 2, o clique num terceiro é ignorado — sem mudar nada)
}

// Aplica (ou remove) o feedback visual de erro num campo + sua mensagem.
// Quando aplica, faz o campo sacudir uma vez.
function marcarErro(input, msgEl, mensagem) {
  input.classList.add('campo-erro');
  msgEl.textContent = mensagem;
  msgEl.classList.add('msg-erro');
  // reinicia a animação de shake (remove e força reflow antes de readicionar)
  input.classList.remove('shake'); void input.offsetWidth; input.classList.add('shake');
}

function limparErro(input, msgEl) {
  input.classList.remove('campo-erro', 'shake');
  msgEl.classList.remove('msg-erro');
  msgEl.textContent = '';
}

// ===================== VALIDAÇÕES =====================
function validarNome() {
  const partes = state.nome.trim().split(/\s+/).filter(Boolean);
  if (partes.length < 2) return { ok: false, msg: 'Informe nome e ao menos um sobrenome.' };
  return { ok: true, msg: '' };
}

function validarTelefone() {
  const dig = state.telefone; // só dígitos (sem o 55)
  if (dig.length !== 11)
    return { ok: false, msg: 'Telefone incompleto (precisa ter 11 dígitos).' };
  const ddd = parseInt(dig.slice(0, 2), 10);
  if (!DDDS.has(ddd)) return { ok: false, msg: 'DDD inválido.' };
  if (dig.length === 11 && dig[2] !== '9')
    return { ok: false, msg: 'Celular deve começar com 9 após o DDD.' };
  return { ok: true, msg: '' };
}

// máscara (XX) XXXXX-XXXX
function aplicarMascara(v) {
  const d = v.replace(/\D/g, '').slice(0, 11);
  if (d.length <= 2) return d.length ? `(${d}` : '';
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}

// ===================== RESUMO =====================
function montarResumo() {
  const serv = servicoEfetivo();
  const dataFmt = new Date(state.horario.inicio).toLocaleDateString('pt-BR', {
    weekday: 'long', day: '2-digit', month: 'long',
  });
  // Com 1 serviço: uma linha "Serviço". Com 2: uma linha por serviço (e o valor
  // total embaixo é a soma, via servicoEfetivo()).
  const linhasServico = state.servicos.length <= 1
    ? `<div class="flex justify-between"><span class="text-clay">Serviço</span><span class="font-medium">${serv.nome}</span></div>`
    : state.servicos.map((s) =>
        `<div class="flex justify-between"><span class="text-clay">Serviço</span><span class="font-medium">${s.nome}</span></div>`
      ).join('');
  $('resumo').innerHTML = `
    <div class="flex justify-between"><span class="text-clay">${(window.__CFG && window.__CFG.labelProfissional) || 'Profissional'}</span><span class="font-medium">${state.profissional.nome}</span></div>
    ${linhasServico}
    <div class="flex justify-between"><span class="text-clay">Data</span><span class="font-medium capitalize">${dataFmt}</span></div>
    <div class="flex justify-between"><span class="text-clay">Horário</span><span class="font-medium">${state.horario.label}</span></div>
    <div class="flex justify-between"><span class="text-clay">Cliente</span><span class="font-medium">${state.nome}</span></div>
    <div class="border-t border-blush/50 pt-3 flex justify-between text-base">
      <span class="text-wine">Valor</span><span class="font-display text-wine">${moeda(serv.valor)}</span>
    </div>`;
}

// ===================== CONFIRMAÇÃO =====================
async function confirmar() {
  const btn = $('btn-confirmar');
  btn.disabled = true;
  $('btn-spinner').classList.remove('hidden');
  $('btn-label').textContent = 'Confirmando…';
  $('erro-final').textContent = '';

  const serv = servicoEfetivo();
  try {
    const r = await fetch(`${API}/agendamento`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        profissionalId: state.profissional.id,
        servicoNome: serv.nome,
        valor: serv.valor,
        clienteNome: state.nome.trim(),
        clienteTelefone: '55' + state.telefone, // E.164
        inicio: state.horario.inicio,
        fim: state.horario.fim,
        sessaoId: SID,
      }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.erro || 'Falha ao agendar.');

    // tela de sucesso
    $('nav-botoes').classList.add('hidden');
    for (let i = 1; i <= 5; i++) $(`view-${i}`).classList.add('hidden');
    const dataFmt = new Date(state.horario.inicio).toLocaleDateString('pt-BR');
    $('sucesso-msg').textContent =
      `${serv.nome} com ${state.profissional.nome} em ${dataFmt} às ${state.horario.label}. ` +
      `Enviamos a confirmação no seu WhatsApp.`;
    $('progress').style.width = '100%';
    $('view-sucesso').classList.remove('hidden');
  } catch (e) {
    $('erro-final').textContent = e.message;
    btn.disabled = false;
  } finally {
    $('btn-spinner').classList.add('hidden');
    $('btn-label').textContent = 'Confirmar Agendamento';
  }
}

// ===================== EVENTOS =====================
// Avança um passo (usado pelo botão "Avançar" e pelo clique direto no serviço).
let autoAvancoTimer = null;
function avancar() {
  if (state.passo === 4) { montarResumo(); trackEvent('dados_preenchidos'); }
  mostrarPasso(Math.min(state.passo + 1, 5));
  if (state.passo === 3) {
    carregarDiasDisponiveis();          // apaga no calendário os dias sem vaga p/ o serviço
    if (state.data) carregarHorarios(); // refaz a grade se já houver dia escolhido
  }
}
$('btn-avancar').onclick = avancar;
$('btn-voltar').onclick = () => mostrarPasso(Math.max(state.passo - 1, 1));
$('btn-confirmar').onclick = confirmar;

// ===================== CALENDÁRIO (janela de 30 dias) =====================
const JANELA_DIAS = 30;
const zerar = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const ymdLocal = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const calHoje = zerar(new Date());
const calLimite = zerar(new Date(calHoje.getTime() + JANELA_DIAS * 86400000));
let calView = new Date(calHoje.getFullYear(), calHoje.getMonth(), 1); // mês exibido

// Busca, para o mês exibido + serviço escolhido, quais DIAS têm horário livre.
// Enquanto carrega marca 'loading' (dias ficam neutros); ao terminar guarda um
// Set com os dias disponíveis. Sem profissional/serviço => null (não bloqueia nada).
async function carregarDiasDisponiveis() {
  const serv = servicoEfetivo();
  if (!state.profissional || !serv) { state.diasDisponiveis = null; renderCalendario(); return; }
  const ano = calView.getFullYear(), mes = calView.getMonth();
  const primeiro = ymdLocal(new Date(ano, mes, 1));
  const ultimo = ymdLocal(new Date(ano, mes + 1, 0));
  state.diasDisponiveis = 'loading';
  renderCalendario();
  try {
    const url = `${API}/dias-disponiveis?profissionalId=${state.profissional.id}` +
                `&inicio=${primeiro}&fim=${ultimo}&duracaoMin=${serv.duracao_min}`;
    const r = await (await fetch(url)).json();
    state.diasDisponiveis = new Set(r.disponiveis || []);
  } catch {
    state.diasDisponiveis = null; // falhou: não bloqueia (deixa clicar; o passo de horário avisa)
  }
  renderCalendario();
}

function renderCalendario() {
  const wrap = $('calendario');
  const ano = calView.getFullYear(), mes = calView.getMonth();
  const nomeMes = calView.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
  const primeiroDiaSemana = new Date(ano, mes, 1).getDay(); // 0 = domingo
  const diasNoMes = new Date(ano, mes + 1, 0).getDate();

  const inicioMesAtual = new Date(calHoje.getFullYear(), calHoje.getMonth(), 1);
  const inicioMesLimite = new Date(calLimite.getFullYear(), calLimite.getMonth(), 1);
  const podeVoltar = new Date(ano, mes, 1) > inicioMesAtual;
  const podeAvancar = new Date(ano, mes, 1) < inicioMesLimite;

  let html = `
    <div class="flex items-center justify-between mb-3">
      <button id="cal-prev" ${podeVoltar ? '' : 'disabled'}
        class="w-8 h-8 rounded-full text-wine hover:bg-blush/40 disabled:opacity-25 disabled:cursor-not-allowed">‹</button>
      <span class="font-display text-wine capitalize">${nomeMes}</span>
      <button id="cal-next" ${podeAvancar ? '' : 'disabled'}
        class="w-8 h-8 rounded-full text-wine hover:bg-blush/40 disabled:opacity-25 disabled:cursor-not-allowed">›</button>
    </div>
    <div class="grid grid-cols-7 gap-1 text-center text-[11px] uppercase tracking-wide text-clay/70 mb-1">
      <span>D</span><span>S</span><span>T</span><span>Q</span><span>Q</span><span>S</span><span>S</span>
    </div>
    <div class="grid grid-cols-7 gap-1">`;

  for (let i = 0; i < primeiroDiaSemana; i++) html += `<span></span>`;
  const carregandoDias = state.diasDisponiveis === 'loading';
  for (let dia = 1; dia <= diasNoMes; dia++) {
    const d = zerar(new Date(ano, mes, dia));
    const iso = ymdLocal(d);
    const fora = d < calHoje || d > calLimite;
    const sel = state.data === iso;
    // dia sem nenhum horário livre para o serviço escolhido
    const indisponivel = (state.diasDisponiveis instanceof Set) && !state.diasDisponiveis.has(iso);
    if (fora || indisponivel) {
      // transparente e não-clicável (passado, fora da janela, ou sem vaga)
      html += `<span class="py-2 text-center text-sm text-clay/25">${dia}</span>`;
    } else if (carregandoDias) {
      // enquanto verifica a disponibilidade do mês: neutro e não-clicável
      html += `<span class="py-2 text-center text-sm text-clay/40">${dia}</span>`;
    } else {
      html += `<button data-dia="${iso}"
        class="cal-dia py-2 rounded-lg text-sm transition-colors
               ${sel ? 'bg-wine text-ivory' : 'text-wineDark hover:bg-blush/40'}">${dia}</button>`;
    }
  }
  html += `</div>`;
  wrap.innerHTML = html;

  const prev = $('cal-prev'), next = $('cal-next');
  if (prev) prev.onclick = () => { calView = new Date(ano, mes - 1, 1); carregarDiasDisponiveis(); };
  if (next) next.onclick = () => { calView = new Date(ano, mes + 1, 1); carregarDiasDisponiveis(); };
  wrap.querySelectorAll('.cal-dia').forEach((b) => {
    b.onclick = () => { state.data = b.dataset.dia; renderCalendario(); carregarHorarios(); };
  });
}

// nome
const inputNome = $('input-nome');
const erroNome = $('erro-nome');

inputNome.oninput = (e) => {
  state.nome = e.target.value;
  // enquanto digita, não "agride" com vermelho; só limpa o erro se já corrigiu.
  if (validarNome().ok) limparErro(inputNome, erroNome);
  atualizarAvancar();
};

// ao SAIR do campo: se estiver incompleto (e a pessoa digitou algo), sacode + vermelho.
inputNome.onblur = () => {
  const v = validarNome();
  if (state.nome.trim() && !v.ok) {
    marcarErro(inputNome, erroNome, v.msg);
  }
};

// telefone com máscara
const inputTel = $('input-telefone');
const erroTel = $('erro-telefone');

inputTel.oninput = (e) => {
  const masked = aplicarMascara(e.target.value);
  e.target.value = masked;
  state.telefone = masked.replace(/\D/g, '');
  if (validarTelefone().ok) limparErro(inputTel, erroTel);
  atualizarAvancar();
};

inputTel.onblur = () => {
  const v = validarTelefone();
  if (state.telefone.length >= 2 && !v.ok) {
    marcarErro(inputTel, erroTel, v.msg);
  }
};

// ===================== NAVEGAÇÃO PELAS ABAS (indicador de passos) =====================
// Permite VOLTAR clicando numa aba anterior. Avançar continua só pelo botão
// (que valida cada passo). Como trocar profissional/serviço limpa o horário,
// ao voltar e mudar algo, o passo de horário é refeito antes de seguir.
document.querySelectorAll('#steps li').forEach((li) => {
  li.addEventListener('click', () => {
    const alvo = +li.dataset.s;
    if (alvo < state.passo) mostrarPasso(alvo); // só volta; nunca pula pra frente
  });
});

// ===================== INIT =====================
if (PERMITIR_DOIS) $('servicos-hint').classList.remove('hidden'); // dica do passo 2
carregarProfissionais(); // ao escolher a profissional, os serviços dela são carregados
renderCalendario();
mostrarPasso(1);
trackEvent('pagina_vista');
