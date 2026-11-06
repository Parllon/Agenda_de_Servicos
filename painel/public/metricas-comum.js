// metricas-comum.js — partes comuns das telas de métricas (visão geral e detalhe
// do salão): utilitários, período, chamadas à API, login e pedaços de desenho.
// Cada tela define as suas funções carregar() e renderizar() e chama iniciar().
'use strict';

// ── Utilitários ──────────────────────────────────────────────────────────────
const $ = (s) => document.querySelector(s);
const fmt = (n) => (n || 0).toLocaleString('pt-BR');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pctTxt = (v, casas = 0) => v.toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas }) + '%';
const DIA_MS = 86400000;
// Datas em horário de São Paulo (UTC-3): às 22h ainda é "hoje", não amanhã.
const SP_MS = 3 * 3600000;
const diaSP = (ms = Date.now()) => new Date(ms - SP_MS).toISOString().slice(0, 10);
const somaDias = (d, n) => { const [a, m, dd] = d.split('-').map(Number); return new Date(Date.UTC(a, m - 1, dd + n)).toISOString().slice(0, 10); };
const nDias = (ini, fim) => Math.round((Date.parse(fim) - Date.parse(ini)) / DIA_MS) + 1;
const listaDias = (ini, fim) => { const out = []; for (let d = ini; d <= fim && out.length < 400; d = somaDias(d, 1)) out.push(d); return out; };
const SEMANA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const SEMANA_LONGA = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
const diaSemana = (d) => new Date(d + 'T12:00:00Z').getUTCDay();
const dataCurta = (d) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
const horaSP = (iso) => new Date(Date.parse(iso) - SP_MS).toISOString().slice(11, 16);

// "hoje, 14:20" / "ontem, 18:05" / "há 9 dias"
function quando(iso) {
  if (!iso) return 'nunca';
  const dias = Math.round((Date.parse(diaSP()) - Date.parse(diaSP(Date.parse(iso)))) / DIA_MS);
  if (dias <= 0) return `hoje, ${horaSP(iso)}`;
  if (dias === 1) return `ontem, ${horaSP(iso)}`;
  return `há ${dias} dias`;
}
const diasDesde = (iso) => iso ? Math.floor((Date.now() - Date.parse(iso)) / DIA_MS) : Infinity;
const linkWhats = (n) => { const d = String(n || '').replace(/\D/g, ''); return d.length >= 10 ? `https://wa.me/${d}` : ''; };

const lerLocal = (k, padrao) => { try { const v = localStorage.getItem(k); return v === null ? padrao : JSON.parse(v); } catch { return padrao; } };
const gravarLocal = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* sem storage */ } };

// ── Estado ───────────────────────────────────────────────────────────────────
const estado = {
  preset: lerLocal('metricas.preset', 7),
  comparar: lerLocal('metricas.comparar', true),
  inicio: '', fim: '',
  dados: null,          // último carregamento (para re-render sem refazer o fetch)
};

function aplicarPreset(n) {
  estado.preset = n;
  estado.fim = diaSP();
  estado.inicio = somaDias(estado.fim, -(n - 1));
}

function periodoAnterior() {
  const len = nDias(estado.inicio, estado.fim);
  const fim = somaDias(estado.inicio, -1);
  return { inicio: somaDias(fim, -(len - 1)), fim, len };
}

function sincronizarBarra() {
  document.querySelectorAll('.btn-p').forEach((b) => b.setAttribute('aria-pressed', String(+b.dataset.dias === estado.preset)));
  $('#dt-inicio').value = estado.inicio;
  $('#dt-fim').value = estado.fim;
  $('#comparar').checked = estado.comparar;
  const len = nDias(estado.inicio, estado.fim);
  $('#rot-comparar').textContent = len === 1 ? 'Comparar com o dia anterior' : `Comparar com os ${len} dias anteriores`;
}

// ── API ──────────────────────────────────────────────────────────────────────
class SemLogin extends Error {}
async function api(url, opcoes) {
  const r = await fetch(url, opcoes);
  if (r.status === 401) throw new SemLogin();
  if (!r.ok) {
    let msg = 'Erro ' + r.status;
    try { msg = (await r.json()).erro || msg; } catch { /* sem corpo */ }
    throw new Error(msg);
  }
  return r.json();
}

// Maior perda entre passos seguidos. Passo com 0 quando um passo depois dele tem
// gente foi PULADO (ex.: salão com 1 profissional não mostra a escolha) — ignora.
function maiorPerda(passos, minimo = 5) {
  const usados = passos.filter(([, v], i) => v > 0 || !passos.slice(i + 1).some(([, w]) => w > 0));
  let pior = null;
  for (let i = 1; i < usados.length; i++) {
    const base = usados[i - 1][1], v = usados[i][1];
    if (base < minimo || v >= base) continue;
    const queda = Math.round((1 - v / base) * 100);
    if (!pior || queda > pior.queda) pior = { etapa: usados[i][0], de: usados[i - 1][0], base, perdidos: base - v, queda };
  }
  return pior;
}

function situacao(c, ped) {
  if (c.ativo === false) return { txt: 'Pausado', cls: 's-cinza', tipo: 'pausado' };
  if (c.ativo == null) return { txt: 'Não está no ar', cls: 's-cinza', tipo: 'fora' };
  if (ped && ped.trial_ate) {
    const faltam = Math.ceil((Date.parse(ped.trial_ate) - Date.now()) / DIA_MS);
    if (faltam > 0) return { txt: `Em teste · falta${faltam > 1 ? 'm' : ''} ${faltam} dia${faltam > 1 ? 's' : ''}`, cls: 's-amarelo', tipo: 'teste', faltam };
    return { txt: 'Teste encerrado', cls: 's-vermelho', tipo: 'encerrado', faltam };
  }
  return { txt: 'Ativo', cls: 's-verde', tipo: 'ativo' };
}

function delta(atual, anterior, { melhorSobe = true, rotuloAnt }) {
  if (anterior == null) return { txt: '', cor: 'var(--suave)' };
  if (atual === anterior) return { txt: '= igual ao período anterior', cor: 'var(--suave)' };
  if (!anterior) return { txt: `↑ ${fmt(atual)} a mais ${rotuloAnt}`, cor: melhorSobe ? 'var(--verde)' : 'var(--vermelho)' };
  const p = Math.round(((atual - anterior) / anterior) * 100);
  const sobe = atual > anterior;
  return { txt: `${sobe ? '↑' : '↓'} ${Math.abs(p)}% vs. ${rotuloAnt.replace(/^que /, '')}`, cor: sobe === melhorSobe ? 'var(--verde)' : 'var(--vermelho)' };
}

function htmlFunil(passos, { topoClaro = false, base: baseFixa, pior } = {}) {
  const base = baseFixa ?? Math.max(1, ...passos.map(([, v]) => v));
  return `<ol class="funil">${passos.map(([rot, v], i) => {
    const anterior = i ? passos[i - 1][1] : null;
    const queda = i && anterior ? Math.round((1 - v / anterior) * 100) : null;
    const cls = [topoClaro && i === 0 ? 'topo' : '', pior && pior === rot ? 'pior' : ''].join(' ');
    const largura = topoClaro && i === 0 ? 100 : Math.min(100, Math.max(v ? 2 : 0, Math.round((v / base) * 100)));
    return `<li class="${cls}">
      <span class="et">${esc(rot)}</span>
      <div class="trilho"><div style="width:${largura}%"></div></div>
      <span class="num">${fmt(v)}</span>
      <span class="queda">${queda == null ? '' : queda > 0 ? `−${queda}%` : queda < 0 ? `+${-queda}%` : '0%'}</span>
    </li>`;
  }).join('')}</ol>`;
}

// ── Eventos ──────────────────────────────────────────────────────────────────
document.querySelectorAll('.btn-p').forEach((b) => b.addEventListener('click', () => {
  aplicarPreset(+b.dataset.dias);
  gravarLocal('metricas.preset', estado.preset);
  carregar();
}));
$('#comparar').addEventListener('change', (e) => {
  estado.comparar = e.target.checked;
  gravarLocal('metricas.comparar', estado.comparar);
  sincronizarBarra();
  renderizar();
});
['dt-inicio', 'dt-fim'].forEach((id) => $('#' + id).addEventListener('change', (e) => {
  const v = e.target.value;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return;
  if (id === 'dt-inicio') estado.inicio = v; else estado.fim = v;
  if (estado.inicio > estado.fim) [estado.inicio, estado.fim] = [estado.fim, estado.inicio];
  if (nDias(estado.inicio, estado.fim) > 366) estado.inicio = somaDias(estado.fim, -365);
  estado.preset = null;
  carregar();
}));

// ── Login ────────────────────────────────────────────────────────────────────
function mostrarLogin() {
  $('#login').style.display = 'flex';
  $('#status').textContent = 'Entre com a senha para ver as métricas.';
  setTimeout(() => $('#senha').focus(), 0);
}

$('#form-login').addEventListener('submit', async (e) => {
  e.preventDefault();
  const r = await fetch('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ senha: $('#senha').value }),
  });
  if (r.ok) {
    $('#login').style.display = 'none';
    $('#senha').value = '';
    $('#login-erro').textContent = '';
    carregar();
  } else {
    $('#login-erro').textContent = r.status === 429 ? 'Muitas tentativas. Espere um pouco.' : 'Senha incorreta.';
  }
});

// Período inicial: ?inicio=&fim= no endereço (vindo da outra tela) ou o último
// botão usado (7 dias se nunca escolheu).
function periodoDoEndereco() {
  const q = new URLSearchParams(location.search);
  const ini = q.get('inicio'), fim = q.get('fim');
  const ok = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d || '') && !Number.isNaN(Date.parse(d));
  if (!ok(ini) || !ok(fim) || ini > fim || nDias(ini, fim) > 366) return false;
  const preset = [1, 7, 30, 90].find((n) => fim === diaSP() && nDias(ini, fim) === n) ?? null;
  Object.assign(estado, { inicio: ini, fim, preset });
  history.replaceState(null, '', location.pathname + location.hash); // o período já foi lido
  return true;
}

async function iniciar() {
  if (!periodoDoEndereco()) aplicarPreset([1, 7, 30, 90].includes(estado.preset) ? estado.preset : 7);
  sincronizarBarra();
  try {
    const j = await (await fetch('/api/sessao')).json();
    if (j.logado) carregar(); else mostrarLogin();
  } catch {
    $('#status').textContent = 'Não consegui falar com o painel.';
  }
}
