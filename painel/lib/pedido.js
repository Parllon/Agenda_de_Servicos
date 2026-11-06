// pedido.js — valida e converte o "pedido" que chega do cadastro do site SlotMe
// (slotme.agendamentos.app.br/cadastro) no formato do sistema: dados.json + .env.
//
// O contrato está no site: Site_agendamentos/src/lib/cadastro/pedido.js
// (montarPedido / paraDadosJson). A conversão é REFEITA aqui de propósito: a rota
// é pública, então nada que o navegador "já converteu" é confiável.
//
// Versões aceitas:
//   1 — original (só presets de tema, sem avisos por WhatsApp)
//   2 — + visual.tema "custom" com visual.tema_custom, + avisos_whatsapp

'use strict';
const C = require('./clientes');

const DOMINIO = 'agendamentos.app.br';
const VERSOES = new Set([1, 2]);

// Subdomínios que um cadastro nunca pode pegar (serviços nossos ou confusos).
const SLUGS_RESERVADOS = new Set([
  'cadastro', 'slotme', 'www', 'painel', 'api', 'crm', 'admin', 'app', 'waha',
  'agendamento', 'agendamentos', 'mail', 'email', 'smtp', 'ftp', 'status',
  'teste', 'test', 'demo', 'suporte', 'ajuda', 'blog', 'site', 'dev',
]);

const LIMITES = {
  texto: 80, observacoes: 1000, profissionais: 10, servicos: 30,
  duracaoMin: 5, duracaoMax: 600, valorMax: 100000, prefixoLabel: 25,
};

const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const CELULAR = /^55[1-9]\d9\d{8}$/; // 55 + DDD + 9 + 8 dígitos (igual ao celularValido do site)
// Só Gmail (convite da agenda Google) e iCloud (agenda por assinatura no iPhone):
// outros provedores davam suporte manual. Mesma lista do site (data/cadastro.js).
const DOMINIOS_EMAIL = new Set(['gmail.com', 'icloud.com', 'me.com', 'mac.com']);
const dominioOk = (email) => DOMINIOS_EMAIL.has(String(email).split('@')[1]?.toLowerCase());

class ErroPedido extends Error {
  constructor(msg) { super(msg); this.status = 400; }
}

const falha = (msg) => { throw new ErroPedido(msg); };
const ehTexto = (v) => typeof v === 'string';
const limpo = (v) => (ehTexto(v) ? v.trim() : '');

// Caracteres de controle (U+0000–U+001F, que inclui \t \n \r, e U+007F).
// SEGURANÇA: o nome do negócio vai para o .env do cliente (WHATSAPP_PREFIXO_LABEL);
// um "\n" ali viraria uma linha nova no .env ("\nCLIENTE=bya"). Por isso nenhum
// campo aceita controle. Única exceção: `multilinha` (observações, textarea do
// site) aceita "\n" — e só ele — porque não vai para o .env.
const CONTROLE = /[\u0000-\u001F\u007F]/;
const CONTROLE_SEM_LF = /[\u0000-\u0009\u000B-\u001F\u007F]/;

function texto(v, campo, { obrigatorio = true, max = LIMITES.texto, multilinha = false } = {}) {
  const t = limpo(v);
  if ((multilinha ? CONTROLE_SEM_LF : CONTROLE).test(t)) falha(`Caracteres inválidos em: ${campo}.`);
  if (obrigatorio && !t) falha(`Campo obrigatório: ${campo}.`);
  if (t.length > max) falha(`Campo muito longo: ${campo}.`);
  return t;
}

function minutos(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

// ---------------------------------------------------------------------------
// Validação: lança ErroPedido (status 400) com mensagem amigável.
// ---------------------------------------------------------------------------
function validarPedido(p) {
  if (!p || typeof p !== 'object') falha('Pedido vazio.');
  if (!VERSOES.has(p.versao)) falha('Versão do cadastro não suportada. Atualize a página e tente de novo.');
  if (!/^SLT-[A-Z0-9]{6}$/.test(p.protocolo || '')) falha('Protocolo inválido.');

  const cons = p.consentimentos || {};
  if (cons.termo_teste !== true || cons.lgpd !== true) falha('É preciso aceitar os termos do teste e a política de privacidade.');

  const contato = p.contato || {};
  texto(contato.nome, 'nome');
  if (!CELULAR.test(contato.whatsapp || '')) falha('WhatsApp inválido.');
  if (!EMAIL.test(contato.email_google || '') || contato.email_google.length > 120) falha('E-mail inválido.');
  if (!dominioOk(contato.email_google)) falha('Use um e-mail do Gmail ou do iCloud.');

  const neg = p.negocio || {};
  texto(neg.nome, 'nome do negócio');
  texto(neg.cidade, 'cidade');
  texto(neg.bairro, 'bairro', { obrigatorio: false });
  texto(neg.instagram, 'instagram', { obrigatorio: false });
  texto(neg.especialidade_rotulo, 'especialidade', { obrigatorio: false });

  const servicos = Array.isArray(p.servicos) ? p.servicos : [];
  if (!servicos.length) falha('Cadastre pelo menos 1 serviço.');
  if (servicos.length > LIMITES.servicos) falha(`No máximo ${LIMITES.servicos} serviços.`);
  const nomesServico = new Set();
  for (const s of servicos) {
    const nome = texto(s && s.nome, 'nome do serviço');
    if (nomesServico.has(nome)) falha(`Serviço repetido: ${nome}.`);
    nomesServico.add(nome);
    const d = Number(s.duracao_min);
    if (!Number.isInteger(d) || d < LIMITES.duracaoMin || d > LIMITES.duracaoMax) falha(`Duração inválida em "${nome}".`);
    const v = Number(s.valor);
    if (!Number.isFinite(v) || v <= 0 || v >= LIMITES.valorMax) falha(`Preço inválido em "${nome}".`);
  }

  const profs = Array.isArray(p.profissionais) ? p.profissionais : [];
  if (!profs.length) falha('Cadastre pelo menos 1 profissional.');
  if (profs.length > LIMITES.profissionais) falha(`No máximo ${LIMITES.profissionais} profissionais.`);
  for (const pr of profs) {
    const nome = texto(pr && pr.nome, 'nome do profissional');
    if (pr.email && (!EMAIL.test(pr.email) || pr.email.length > 120)) falha(`E-mail inválido de ${nome}.`);
    if (pr.email && !dominioOk(pr.email)) falha(`${nome}: use um e-mail do Gmail ou do iCloud.`);
    const lista = Array.isArray(pr.servicos) ? pr.servicos : [];
    if (!lista.length) falha(`${nome}: escolha pelo menos 1 serviço.`);
    for (const s of lista) if (!nomesServico.has(s)) falha(`${nome}: serviço desconhecido.`);
    texto(pr.horario_diferente, 'horário diferente', { obrigatorio: false, max: 200 });
    if (pr.foto != null && !ehTexto(pr.foto)) falha('Foto inválida.');
  }

  const hor = p.horarios || {};
  const semana = Array.isArray(hor.semana) ? hor.semana : [];
  if (semana.length !== 7) falha('Horários incompletos.');
  const abertos = semana.filter((d) => d && d.aberto === true);
  if (!abertos.length) falha('Abra pelo menos 1 dia da semana.');
  for (const d of semana) {
    if (!Number.isInteger(d.dia) || d.dia < 0 || d.dia > 6) falha('Dia da semana inválido.');
    if (d.aberto) {
      if (!HORA.test(d.abre || '') || !HORA.test(d.fecha || '')) falha('Horário inválido.');
      if (minutos(d.fecha) <= minutos(d.abre)) falha('O horário de fechar precisa ser depois do de abrir.');
    }
  }

  // Almoço: igual para todos (horarios.pausa) ou um por profissional
  // (pausa_por_profissional + profissionais[].pausa). Vira evento na agenda (lib/pausas.js).
  const abreMin = Math.min(...abertos.map((d) => minutos(d.abre)));
  const fechaMax = Math.max(...abertos.map((d) => minutos(d.fecha)));
  const validarPausa = (pz, quem) => {
    if (pz == null) return;
    if (typeof pz !== 'object' || !HORA.test(pz.inicio || '') || !HORA.test(pz.fim || '')) falha(`Horário de almoço inválido${quem}.`);
    if (minutos(pz.fim) <= minutos(pz.inicio)) falha(`O almoço precisa terminar depois de começar${quem}.`);
    if (minutos(pz.inicio) < abreMin || minutos(pz.fim) > fechaMax) falha(`O almoço precisa ficar dentro do horário de funcionamento${quem}.`);
  };
  if (hor.pausa_por_profissional) {
    for (const pr of profs) validarPausa(pr.pausa, ` de ${limpo(pr.nome)}`);
  } else {
    validarPausa(hor.pausa, '');
  }

  const vis = p.visual || {};
  if (vis.tema !== 'auto' && vis.tema !== 'custom' && !C.TEMAS.includes(vis.tema)) falha('Estilo inválido.');
  if (vis.perfil && !C.PERFIS.includes(vis.perfil)) falha('Perfil inválido.');
  if (vis.tema === 'custom') {
    if (p.versao < 2) falha('Cor personalizada exige a versão nova do cadastro.');
    const tc = vis.tema_custom || {};
    if (!C.HEX_COR.test(tc.cor_primaria || '')) falha('Cor principal inválida.');
    if (tc.cor_destaque && !C.HEX_COR.test(tc.cor_destaque)) falha('Cor de detalhe inválida.');
    if (tc.modo && !['claro', 'escuro'].includes(tc.modo)) falha('Fundo inválido (claro ou escuro).');
  }

  const av = p.avisos_whatsapp;
  if (av && av.ativo && !CELULAR.test(av.numero || '')) falha('Número para avisos no WhatsApp inválido.');

  texto(p.observacoes, 'observações', { obrigatorio: false, max: LIMITES.observacoes, multilinha: true });
  return true;
}

// ---------------------------------------------------------------------------
// Slug (subdomínio). Só [a-z0-9-]: "_" e "." quebram/confundem o DNS.
// ---------------------------------------------------------------------------
function slugBase(texto) {
  return String(texto || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, 'e')
    .replace(/[^a-z0-9]+/g, '')
    .slice(0, 30);
}

function escolherSlug(pedido) {
  let base = slugBase(pedido.negocio.nome);
  if (base.length < 3) base = `${base}${slugBase(pedido.negocio.cidade)}`.slice(0, 30);
  if (base.length < 3) base = 'salao';
  const livre = (s) => !SLUGS_RESERVADOS.has(s) && !C.existe(s);
  if (livre(base)) return base;
  for (let i = 2; i < 100; i++) {
    const s = `${base.slice(0, 28)}${i}`;
    if (livre(s)) return s;
  }
  throw new Error('Não consegui gerar um endereço livre para este negócio.');
}

// ---------------------------------------------------------------------------
// Conversão pedido -> { tema, perfil, dados, env, avisos }
// Mesmos campos que o wizard do painel grava (public/cadastro.js criarCliente).
// ---------------------------------------------------------------------------
function paraConfig(p, { slug }) {
  const url = `https://${slug}.${DOMINIO}`;
  const abertos = p.horarios.semana.filter((d) => d.aberto);
  const inicio = Math.min(...abertos.map((d) => minutos(d.abre)));
  const fim = Math.max(...abertos.map((d) => minutos(d.fecha)));

  const avisos = [];
  if (new Set(abertos.map((d) => `${d.abre}-${d.fecha}`)).size > 1) avisos.push('Horários diferentes por dia da semana — o sistema usa um só horário.');
  if (abertos.some((d) => d.abre.endsWith(':30') || d.fecha.endsWith(':30'))) avisos.push('Horário com meia hora — o sistema arredonda para hora cheia.');
  // Almoço de cada um (recalculado aqui, sem confiar no que o site resolveu):
  // a fase "almoco" do provisionar.js transforma em evento na agenda dele.
  const individual = p.horarios.pausa_por_profissional === true;
  const pausaDe = (pr) => {
    const pz = individual ? pr.pausa : p.horarios.pausa;
    return pz ? { inicio: pz.inicio, fim: pz.fim } : null;
  };
  for (const pr of p.profissionais) {
    const pz = pausaDe(pr);
    if (pz) avisos.push(`${limpo(pr.nome)}: almoço ${pz.inicio}–${pz.fim} bloqueado na agenda.`);
  }
  for (const pr of p.profissionais) if (pr.horario_diferente) avisos.push(`${pr.nome}: horário diferente (${pr.horario_diferente}).`);

  // Tema: preset escolhido, cor personalizada, ou o sugerido pela especialidade.
  const vis = p.visual;
  let tema = vis.tema;
  if (tema === 'auto') tema = C.TEMAS.includes(vis.tema_sugerido) ? vis.tema_sugerido : 'tema_8';
  const tc = tema === 'custom' ? vis.tema_custom : null;
  const temaCustom = tc
    ? { cor_primaria: tc.cor_primaria, cor_destaque: tc.cor_destaque || '', modo: tc.modo === 'escuro' ? 'escuro' : 'claro' }
    : { cor_primaria: '', cor_destaque: '', modo: 'claro' };
  const perfil = C.PERFIS.includes(vis.perfil) ? vis.perfil : 'profissional';

  const av = p.avisos_whatsapp;
  const whatsappAviso = av && av.ativo ? av.numero : '';

  const servicoPorNome = Object.fromEntries(p.servicos.map((s) => [limpo(s.nome), s]));
  const nomeNegocio = limpo(p.negocio.nome);

  const dados = {
    negocio: {
      nome: nomeNegocio,
      subtitulo: limpo(p.negocio.especialidade_rotulo),
      cidade: limpo(p.negocio.cidade),
      rede_social: limpo(p.negocio.instagram),
      telefone: p.contato.whatsapp,
      whatsapp_contato: p.contato.whatsapp,
      telegram_chat_id: '',
      whatsapp_aviso: whatsappAviso,
      calendar_central: '',
      email_dono: p.contato.email_google.trim().toLowerCase(),
      og_imagem: '',
      permitir_dois_servicos: false,
      tema_custom: temaCustom,
    },
    mensagens: {},
    profissionais: p.profissionais.map((pr, i) => ({
      id: i + 1,
      nome: limpo(pr.nome),
      calendar_id: '',
      email: limpo(pr.email).toLowerCase(),
      subject_email: null,
      foto_url: '',
      telegram_chat_id: '',
      ...(pausaDe(pr) ? { pausa: pausaDe(pr) } : {}),
      servicos: pr.servicos.map((nome) => ({
        nome,
        duracao_min: Number(servicoPorNome[nome].duracao_min),
        valor: Number(servicoPorNome[nome].valor),
      })),
    })),
  };

  const env = {
    TEMA: tema,
    PERFIL_PROFISSIONAL: perfil,
    EXPEDIENTE_INICIO: String(Math.floor(inicio / 60)),
    EXPEDIENTE_FIM: String(Math.ceil(fim / 60)),
    FOLGAS: p.horarios.semana.filter((d) => !d.aberto).map((d) => d.dia).join(','),
    SLOT_STEP_MIN: '30',
    JANELA_DIAS: '30',
    WHATSAPP_MODE: 'central',
    WHATSAPP_INSTANCE: 'agendamento',
    WHATSAPP_INSTANCE_CENTRAL: 'agendamento',
    WHATSAPP_PREFIXO_NOME: 'true',
    // sem # (vira comentário no .env) nem aspas
    WHATSAPP_PREFIXO_LABEL: nomeNegocio.replace(/[#"'\\]/g, '').slice(0, LIMITES.prefixoLabel).trim(),
    CORS_ORIGIN: url,
    LANDING_URL: url,
  };

  return { slug, url, tema, perfil, dados, env, avisos };
}

module.exports = { validarPedido, escolherSlug, paraConfig, slugBase, ErroPedido, DOMINIO };
