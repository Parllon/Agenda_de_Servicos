// mensagens.js — textos das mensagens automáticas (WhatsApp).
//
// COMO FUNCIONA (multi-cliente):
//   - Os textos abaixo (PADRAO) são o "padrão de fábrica" — todo cliente usa, sem
//     configurar nada.
//   - Cada cliente pode SOBRESCREVER no seu dados.json, numa seção "mensagens".
//     Sobrescreve só os tipos que quiser; o resto continua no padrão.
//   - Mandar SEMPRE a mesma frase é cara de bot, então cada tipo aceita VÁRIAS
//     versões (uma lista) e o sistema sorteia uma a cada envio.
//
// Chaves entre {} são trocadas pelos dados reais:
//   {nome}         -> primeiro nome do cliente
//   {servico}      -> nome do serviço
//   {profissional} -> nome do profissional
//   {data}         -> data (ex.: 04/06/2026)
//   {hora}         -> horário (ex.: 14:00)
//   {link}         -> link de reagendamento (LANDING_URL)
//
// FORMATO no dados.json (tudo opcional):
//   "mensagens": {
//     "confirmado": "Valeu, {nome}! Te espero. 💈",          // uma frase, OU
//     "confirmacao": ["Versao 1 ...", "Versao 2 ..."]          // uma lista de frases
//   }

const fs = require('fs');

// ---------- Padrão de fábrica ----------
const PADRAO = {
  // Enviada no momento do agendamento
  confirmacao: [
    'Oi, {nome}! Horário confirmado. ✅\n\n{servico} com {profissional}\n📅 {data} às {hora}\n\n2️⃣ Reagendar · 3️⃣ Cancelar',
    '{nome}, tudo confirmado! 😊\n\n{servico} com {profissional}\n📅 {data} às {hora}\n\n2️⃣ Reagendar · 3️⃣ Cancelar',
    'Agendamento confirmado, {nome}! ✨\n\n{servico} com {profissional}\n📅 {data} às {hora}\n\n2️⃣ Reagendar · 3️⃣ Cancelar',
    'Oi, {nome}! Você está na agenda. 🗓️\n\n{servico} com {profissional}\n📅 {data} às {hora}\n\n2️⃣ Reagendar · 3️⃣ Cancelar',
    '{nome}, anotado! Te esperamos. 💛\n\n{servico} com {profissional}\n📅 {data} às {hora}\n\n2️⃣ Reagendar · 3️⃣ Cancelar',
    'Confirmado, {nome}! 💅\n\n{servico} com {profissional}\n📅 {data} às {hora}\n\n2️⃣ Reagendar · 3️⃣ Cancelar',
    'Oi, {nome}! Horário garantido. 🙌\n\n{servico} com {profissional}\n📅 {data} às {hora}\n\n2️⃣ Reagendar · 3️⃣ Cancelar',
    '{nome}, feito! Até lá. 💛\n\n{servico} com {profissional}\n📅 {data} às {hora}\n\n2️⃣ Reagendar · 3️⃣ Cancelar',
    'Olá, {nome}! Tudo certo. ✅\n\n{servico} com {profissional}\n📅 {data} às {hora}\n\n2️⃣ Reagendar · 3️⃣ Cancelar',
    '{nome}! Horário marcado. 😊\n\n{servico} com {profissional}\n📅 {data} às {hora}\n\n2️⃣ Reagendar · 3️⃣ Cancelar',
  ],

  // Lembrete na véspera (com as opções 1/2/3)
  vespera: [
    'Oi, {nome}! Amanhã tem {servico} às {hora}. 📅\n\n1️⃣ Confirmar · 2️⃣ Reagendar · 3️⃣ Cancelar',
    '{nome}, lembrete: amanhã às {hora} — {servico}. 😊\n\n1️⃣ Confirmar · 2️⃣ Reagendar · 3️⃣ Cancelar',
    'Oi, {nome}! Passando lembrar do horário de amanhã. ✨\n\n{servico} às {hora}\n\n1️⃣ Confirmar · 2️⃣ Reagendar · 3️⃣ Cancelar',
    '{nome}, amanhã é dia! 💛 {servico} às {hora}.\n\n1️⃣ Confirmar · 2️⃣ Reagendar · 3️⃣ Cancelar',
    'Boa noite, {nome}! Lembrete do horário de amanhã. 🌙\n\n{servico} às {hora}\n\n1️⃣ Confirmar · 2️⃣ Reagendar · 3️⃣ Cancelar',
    'Olá, {nome}! Amanhã tem horário marcado. 🗓️\n\n{servico} às {hora}\n\n1️⃣ Confirmar · 2️⃣ Reagendar · 3️⃣ Cancelar',
    '{nome}! Não esquece: amanhã às {hora}, {servico}.\n\n1️⃣ Confirmar · 2️⃣ Reagendar · 3️⃣ Cancelar',
    'Oi, {nome}! Aviso rápido: amanhã tem {servico} às {hora}. 😊\n\n1️⃣ Confirmar · 2️⃣ Reagendar · 3️⃣ Cancelar',
    '{nome}, seu horário de amanhã: {servico} às {hora}. 📋\n\n1️⃣ Confirmar · 2️⃣ Reagendar · 3️⃣ Cancelar',
    'Olá, {nome}! Confirmando o horário de amanhã. 💅\n\n{servico} às {hora}\n\n1️⃣ Confirmar · 2️⃣ Reagendar · 3️⃣ Cancelar',
  ],

  // Lembrete poucas horas antes
  lembrete1h: [
    'Oi, {nome}! Seu horário de {servico} é daqui a pouco. ⏰ Até já!',
    '{nome}, quase na hora! {servico} às {hora}. 😊',
    'Olá, {nome}! Falta pouquinho: {servico} às {hora}. ✨',
    '{nome}! É daqui a pouco — {servico} às {hora}. Te espero! 💛',
    'Oi, {nome}! Lembrete rápido: {servico} às {hora}. ⏰',
    '{nome}, hora chegando! {servico} às {hora}. 🙌',
    'Olá, {nome}! {servico} às {hora}. Até já! 😊',
    'Oi, {nome}! Não esquece: {servico} às {hora}. ✅',
    '{nome}! {servico} em breve, às {hora}. Te esperamos! 💅',
    'Oi, {nome}! Hoje tem {servico} às {hora}. Falta pouco! ⏰',
  ],

  // Resposta quando o cliente escolhe reagendar (opção 2)
  reagendar: [
    'Feito, {nome}! Horário liberado. Remarque quando quiser:\n👉 {link}',
    'Tudo certo, {nome}! Liberamos. Escolha um novo horário:\n👉 {link}',
    '{nome}, liberado! Agende outro quando preferir:\n👉 {link}',
    'Ok, {nome}! Horário livre. Marque quando quiser:\n👉 {link}',
    'Pronto, {nome}! Cancelado aqui. Remarque no link:\n👉 {link}',
    '{nome}, feito! Quando quiser, é só agendar:\n👉 {link}',
    'Tranquilo, {nome}! Horário liberado. Quando puder:\n👉 {link}',
    'Sem problema, {nome}! Liberado. Novo horário:\n👉 {link}',
    '{nome}! Horário livre. Escolha outro quando quiser:\n👉 {link}',
    'Ok, {nome}! Liberado. Remarque quando der:\n👉 {link}',
  ],

  // Resposta quando o cliente confirma (opção 1)
  confirmado: [
    'Confirmado, {nome}! Te esperamos. ✅',
    'Perfeito, {nome}! Presença anotada. 😊',
    '{nome}, ótimo! Até logo. 💛',
    'Maravilha, {nome}! Até breve. ✨',
    '{nome}, confirmado! Nos vemos em breve. 🙌',
    'Tudo certo, {nome}! Até lá. ✅',
    '{nome}! Confirmado. Até já. 💅',
    'Show, {nome}! Te esperamos. 😊',
    'Boa, {nome}! Anotado aqui. ✅',
    '{nome}, combinado! Até breve. 💛',
  ],

  // Resposta quando o cliente cancela (opção 3)
  cancelado: [
    'Cancelado, {nome}! Quando quiser voltar é só agendar. 😊',
    'Tudo bem, {nome}! Horário cancelado. Até a próxima. 💛',
    '{nome}, feito! Cancelei aqui. Qualquer hora é só chamar.',
    'Ok, {nome}! Cancelado. Quando precisar é só agendar. ✅',
    '{nome}, cancelamento feito! Até a próxima. 😊',
    'Tranquilo, {nome}! Cancelei. Quando quiser remarcar é só agendar.',
    'Feito, {nome}! Horário liberado. Até logo. 💛',
    '{nome}, tudo certo! Cancelado aqui. 😊',
    'Ok, {nome}! Cancelado. Até a próxima. ✅',
    '{nome}! Cancelado. Se mudar de ideia, é só agendar. 💛',
  ],
};

// ---------- Customizações do cliente (seção "mensagens" do dados.json) ----------
function carregarCustom() {
  try {
    const cam = process.env.CAMINHO_DADOS_JSON;
    if (cam && fs.existsSync(cam)) {
      const m = JSON.parse(fs.readFileSync(cam, 'utf8')).mensagens;
      if (m && typeof m === 'object') return m;
    }
  } catch (e) {
    console.error('[mensagens] customizacoes ignoradas (erro ao ler dados.json):', e.message);
  }
  return {};
}

// Lê o bloco "negocio" do dados.json (nome, telefone, whatsapp_contato) — usado
// no rodapé de contato. Vazio/erro = sem rodapé (degrada sem quebrar nada).
function carregarNegocio() {
  try {
    const cam = process.env.CAMINHO_DADOS_JSON;
    if (cam && fs.existsSync(cam)) {
      const n = JSON.parse(fs.readFileSync(cam, 'utf8')).negocio;
      if (n && typeof n === 'object') return n;
    }
  } catch (e) {
    console.error('[mensagens] negocio ignorado (erro ao ler dados.json):', e.message);
  }
  return {};
}

const NEGOCIO = carregarNegocio();
const MODO_WHATSAPP = (process.env.WHATSAPP_MODE || 'proprio').toLowerCase();
const LANDING_URL = (process.env.LANDING_URL || '').replace(/\/$/, '');

// Rodapé que identifica o salão e dá um link de contato. SÓ no modo central
// (no modo próprio o cliente já está conversando com o número do salão). Sem número
// configurado (whatsapp_contato/telefone) = sem rodapé.
// Usa /link (com OG customizado) se LANDING_URL estiver configurado; senão wa.me direto.
function rodapeContato() {
  if (MODO_WHATSAPP !== 'central') return '';
  const num = String(NEGOCIO.whatsapp_contato || NEGOCIO.telefone || '').replace(/\D/g, '');
  if (!num) return '';
  const nome = NEGOCIO.nome || 'o salão';
  const link = LANDING_URL ? `${LANDING_URL}/link` : `https://wa.me/${num}`;
  return `\n\n*${nome}*\nQualquer dúvida ou se precisar falar com a gente, é só clicar:\n${link}`;
}

// Tipos de mensagem que ganham o rodapé de contato (os enviados ao cliente final
// nos momentos em que ele pode querer falar com o salão).
const COM_RODAPE = new Set(['confirmacao', 'vespera']);

// Merge por tipo: o cliente sobrescreve só o que definir; o resto fica no padrão.
// Aceita string (uma frase) ou lista de frases.
const custom = carregarCustom();
const VARIACOES = {};
for (const tipo of Object.keys(PADRAO)) {
  let c = custom[tipo];
  if (typeof c === 'string') c = [c];
  VARIACOES[tipo] = Array.isArray(c) && c.length ? c : PADRAO[tipo];
}

const randItem = (arr) => arr[Math.floor(Math.random() * arr.length)];

/**
 * Monta uma mensagem sorteando uma das variacoes e preenchendo os dados.
 * @param {string} tipo  - confirmacao | vespera | lembrete1h | reagendar | confirmado | cancelado
 * @param {object} dados - { nome, servico, profissional, data, hora, link }
 */
function montarMensagem(tipo, dados = {}) {
  const lista = VARIACOES[tipo];
  if (!lista) throw new Error(`Tipo de mensagem desconhecido: ${tipo}`);

  let texto = randItem(lista);
  for (const [chave, valor] of Object.entries(dados)) {
    texto = texto.replaceAll(`{${chave}}`, valor ?? '');
  }
  if (COM_RODAPE.has(tipo)) texto += rodapeContato();
  return texto;
}

module.exports = { montarMensagem, VARIACOES, PADRAO };


