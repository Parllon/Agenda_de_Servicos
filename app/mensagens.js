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
    'Oi, {nome}! O seu horário está confirmadíssimo. ✨\n\n🏆 Serviço: {servico}\n👤 Com: {profissional}\n📅 Data: {data}\n⏰ Horário: {hora}\n\nPrecisa fazer alguma alteração?\n\nÉ só responder com o número:\n2️⃣ - Reagendar\n3️⃣ - Cancelar',
    'Olá, {nome}! Tudo confirmado por aqui. 😊\n\n🏆 Serviço: {servico}\n👤 Com: {profissional}\n📅 Data: {data}\n⏰ Horário: {hora}\n\nPrecisa fazer alguma alteração?\n\nÉ só responder com o número:\n2️⃣ - Reagendar\n3️⃣ - Cancelar',
    '{nome}, anotamos tudo! Te esperamos. 💛\n\n🏆 Serviço: {servico}\n👤 Com: {profissional}\n📅 Data: {data}\n⏰ Horário: {hora}\n\nPrecisa fazer alguma alteração?\n\nÉ só responder com o número:\n2️⃣ - Reagendar\n3️⃣ - Cancelar',
    'Oi, {nome}! Agendamento confirmado com sucesso. ✅\n\n🏆 Serviço: {servico}\n👤 Com: {profissional}\n📅 Data: {data}\n⏰ Horário: {hora}\n\nPrecisa fazer alguma alteração?\n\nÉ só responder com o número:\n2️⃣ - Reagendar\n3️⃣ - Cancelar',
    'Prontinho, {nome}! Você está na agenda. 🗓️\n\n🏆 Serviço: {servico}\n👤 Com: {profissional}\n📅 Data: {data}\n⏰ Horário: {hora}\n\nPrecisa fazer alguma alteração?\n\nÉ só responder com o número:\n2️⃣ - Reagendar\n3️⃣ - Cancelar',
    '{nome}, confirmado! Não vemos a hora de te atender. 💅\n\n🏆 Serviço: {servico}\n👤 Com: {profissional}\n📅 Data: {data}\n⏰ Horário: {hora}\n\nPrecisa fazer alguma alteração?\n\nÉ só responder com o número:\n2️⃣ - Reagendar\n3️⃣ - Cancelar',
    'Oi, {nome}! Tudo anotado e confirmado. ✨\n\n🏆 Serviço: {servico}\n👤 Com: {profissional}\n📅 Data: {data}\n⏰ Horário: {hora}\n\nPrecisa fazer alguma alteração?\n\nÉ só responder com o número:\n2️⃣ - Reagendar\n3️⃣ - Cancelar',
    'Olá, {nome}! Seu horário está garantido. 🙌\n\n🏆 Serviço: {servico}\n👤 Com: {profissional}\n📅 Data: {data}\n⏰ Horário: {hora}\n\nPrecisa fazer alguma alteração?\n\nÉ só responder com o número:\n2️⃣ - Reagendar\n3️⃣ - Cancelar',
    '{nome}, feito! Te esperamos com tudo pronto. 😍\n\n🏆 Serviço: {servico}\n👤 Com: {profissional}\n📅 Data: {data}\n⏰ Horário: {hora}\n\nPrecisa fazer alguma alteração?\n\nÉ só responder com o número:\n2️⃣ - Reagendar\n3️⃣ - Cancelar',
    'Oi, {nome}! Agendamento feito. Até lá! 💛\n\n🏆 Serviço: {servico}\n👤 Com: {profissional}\n📅 Data: {data}\n⏰ Horário: {hora}\n\nPrecisa fazer alguma alteração?\n\nÉ só responder com o número:\n2️⃣ - Reagendar\n3️⃣ - Cancelar',
  ],

  // Lembrete na véspera (com as opções 1/2/3)
  vespera: [
    'Oi, {nome}! Passando pra lembrar do seu horário amanhã. 📅\n\n🏆 Serviço: {servico}\n⏰ Horário: {hora}\n\nTudo certo?\n\nÉ só responder com o número:\n1️⃣ - Confirmar\n2️⃣ - Reagendar\n3️⃣ - Cancelar',
    'Olá, {nome}! Amanhã é dia de compromisso! 😊\n\n🏆 Serviço: {servico}\n⏰ Horário: {hora}\n\nConfirma pra mim?\n\nÉ só responder com o número:\n1️⃣ - Confirmar\n2️⃣ - Reagendar\n3️⃣ - Cancelar',
    '{nome}, lembrando do seu agendamento amanhã! 💛\n\n🏆 Serviço: {servico}\n⏰ Horário: {hora}\n\nMe avisa como vai ficar:\n\nÉ só responder com o número:\n1️⃣ - Confirmar\n2️⃣ - Reagendar\n3️⃣ - Cancelar',
    'Oi, {nome}! Só um aviso rápido. 😊\n\n🏆 Serviço: {servico}\n⏰ Horário: {hora}\n\nAmanhã tem horário marcado! Tudo certo?\n\nÉ só responder com o número:\n1️⃣ - Confirmar\n2️⃣ - Reagendar\n3️⃣ - Cancelar',
    '{nome}! Não esquece, amanhã tem horário. ✨\n\n🏆 Serviço: {servico}\n⏰ Horário: {hora}\n\nConfirma sua presença?\n\nÉ só responder com o número:\n1️⃣ - Confirmar\n2️⃣ - Reagendar\n3️⃣ - Cancelar',
    'Boa noite, {nome}! Lembrete do seu horário de amanhã. 🌙\n\n🏆 Serviço: {servico}\n⏰ Horário: {hora}\n\nTudo certinho?\n\nÉ só responder com o número:\n1️⃣ - Confirmar\n2️⃣ - Reagendar\n3️⃣ - Cancelar',
    'Olá, {nome}! Amanhã é dia de cuidar de você. 💅\n\n🏆 Serviço: {servico}\n⏰ Horário: {hora}\n\nConfirma pra mim?\n\nÉ só responder com o número:\n1️⃣ - Confirmar\n2️⃣ - Reagendar\n3️⃣ - Cancelar',
    'Oi, {nome}! Passando pra confirmar amanhã. 📋\n\n🏆 Serviço: {servico}\n⏰ Horário: {hora}\n\nMe conta o que prefere:\n\nÉ só responder com o número:\n1️⃣ - Confirmar\n2️⃣ - Reagendar\n3️⃣ - Cancelar',
    '{nome}, seu horário de amanhã está reservado! 🗓️\n\n🏆 Serviço: {servico}\n⏰ Horário: {hora}\n\nTudo certo por aí?\n\nÉ só responder com o número:\n1️⃣ - Confirmar\n2️⃣ - Reagendar\n3️⃣ - Cancelar',
    'Oi, {nome}! Lembrando que amanhã você tem horário marcado. 😍\n\n🏆 Serviço: {servico}\n⏰ Horário: {hora}\n\nConfirme sua presença:\n\nÉ só responder com o número:\n1️⃣ - Confirmar\n2️⃣ - Reagendar\n3️⃣ - Cancelar',
  ],

  // Lembrete poucas horas antes
  lembrete1h: [
    'Oi, {nome}! Seu horário é daqui a pouco. ⏰\n\n🏆 Serviço: {servico}\n⏰ Horário: {hora}\n\nTe esperamos! 💅',
    '{nome}, quase na hora! 😊\n\n🏆 Serviço: {servico}\n⏰ Horário: {hora}\n\nAté já! ✨',
    'Olá, {nome}! Falta pouquinho pro seu horário. 🕐\n\n🏆 Serviço: {servico}\n⏰ Horário: {hora}\n\nNos vemos em breve!',
    'Oi, {nome}! Hora chegando! 🙌\n\n🏆 Serviço: {servico}\n⏰ Horário: {hora}\n\nTe aguardo! 💛',
    '{nome}! É daqui a pouco. 😍\n\n🏆 Serviço: {servico}\n⏰ Horário: {hora}\n\nEstou te esperando!',
    'Olá, {nome}! Só um lembrete rápido. ⏰\n\n🏆 Serviço: {servico}\n⏰ Horário: {hora}\n\nNos vemos logo! 💅',
    'Oi, {nome}! O horário está chegando. ✨\n\n🏆 Serviço: {servico}\n⏰ Horário: {hora}\n\nAté já! 😊',
    '{nome}, não se esqueça! 🗓️\n\n🏆 Serviço: {servico}\n⏰ Horário: {hora}\n\nTe vejo em breve!',
    'Olá, {nome}! Passando pra lembrar do horário de hoje. 💛\n\n🏆 Serviço: {servico}\n⏰ Horário: {hora}\n\nNos vemos logo!',
    'Oi, {nome}! Hoje tem horário marcado. 😊\n\n🏆 Serviço: {servico}\n⏰ Horário: {hora}\n\nFalta pouquinho — te espero! 💅',
  ],

  // Resposta quando o cliente escolhe reagendar (opção 2)
  reagendar: [
    'Sem problema, {nome}! Horário liberado. 🗓️\n\nPara escolher um novo horário:\n👉 {link}',
    'Tranquilo, {nome}! Horário cancelado. 😊\n\nEscolha outro quando quiser:\n👉 {link}',
    '{nome}, feito! Seu horário foi liberado. ✅\n\nPara remarcar é só clicar:\n👉 {link}',
    'Tudo bem, {nome}! Liberamos o horário. 🙌\n\nRemarque quando preferir:\n👉 {link}',
    'Feito, {nome}! Horário liberado com sucesso. 💛\n\nEscolha um novo horário aqui:\n👉 {link}',
    'Anotado, {nome}! Pode ficar tranquilo. ✨\n\nQuando estiver pronto, agende aqui:\n👉 {link}',
    '{nome}, liberado! Assim que quiser, marque um novo horário:\n👉 {link}',
    'Perfeito, {nome}! Horário livre. 🗓️\n\nPara remarcar é só clicar:\n👉 {link}',
    'Sem estresse, {nome}! Tá liberado. 😊\n\nEscolha outro horário quando puder:\n👉 {link}',
    'Tá bom, {nome}! Liberado. ✅\n\nRemarque no momento certo pra você:\n👉 {link}',
  ],

  // Resposta quando o cliente confirma (opção 1)
  confirmado: [
    'Perfeito, {nome}! Presença confirmada. ✅\n\nTe esperamos! 💛',
    'Maravilha, {nome}! Tudo anotado. 😊\n\nAté lá! 💅',
    'Show, {nome}! Confirmado com sucesso. ✨\n\nNos vemos em breve!',
    'Ótimo, {nome}! Você está confirmado. 🙌\n\nAté breve!',
    'Que bom, {nome}! Presença anotada. 💛\n\nTe espero!',
    'Perfeito, {nome}! Anotado por aqui. ✅\n\nAté logo! 😊',
    '{nome}, confirmado! Fico feliz em te ver em breve. 😍\n\nAté lá!',
    'Confirmado, {nome}! Te esperamos no horário. 🙌\n\nAté breve!',
    'Tudo certo, {nome}! Você está na agenda. ✅\n\nNos vemos em breve!',
    'Boa, {nome}! Presença confirmada. 💅\n\nAté já! 😊',
  ],

  // Resposta quando o cliente cancela (opção 3)
  cancelado: [
    'Tudo bem, {nome}! Horário cancelado. ✅\n\nQuando quiser, é só chamar! 💛',
    'Sem problemas, {nome}! Cancelei aqui. 😊\n\nEspero te ver numa próxima!',
    '{nome}, cancelamento feito. ✅\n\nQualquer hora que quiser remarcar, é só chamar!',
    'Ok, {nome}! Horário cancelado. 💛\n\nQuando precisar, estarei por aqui. 😊',
    'Tudo certo, {nome}! Cancelamento confirmado. ✨\n\nAté a próxima!',
    'Feito, {nome}! Horário liberado. 💛\n\nQuando quiser voltar, é só agendar! 😊',
    '{nome}, cancelado com sucesso. ✅\n\nSe mudar de ideia, é só chamar. Até logo!',
    'Tranquilo, {nome}! Cancelei aqui. 🙌\n\nEspero te ver em breve!',
    'Ok, {nome}! Tudo cancelado. 😊\n\nQuando quiser, a gente agenda de novo!',
    '{nome}, cancelamento feito! ✅\n\nEstarei aqui sempre que precisar. Até a próxima! 😊',
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


