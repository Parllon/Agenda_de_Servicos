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
    'Oi, {nome}! 💅 Seu horário de {servico} está confirmado para {data} às {hora} com {profissional}. Até lá!',
    'Olá, {nome}! Tudo certo com seu agendamento: {servico} em {data}, {hora}, com {profissional}. Te espero! 😊',
    '{nome}, confirmado! {servico} marcado para {data} às {hora} com {profissional}. Qualquer coisa, é só responder por aqui.',
    'Oi, {nome}! Anotei aqui: {servico} no dia {data}, às {hora}, com {profissional}. Nos vemos em breve! ✨',
  ],

  // Lembrete na véspera (com as opções 1/2/3)
  vespera: [
    'Oi, {nome}! Passando pra lembrar: amanhã você tem {servico} às {hora}. Responda:\n1 - Confirmar\n2 - Reagendar\n3 - Cancelar',
    'Olá, {nome}! Amanhã é dia de {servico}, às {hora}. Pode me confirmar?\n1 - Confirmar\n2 - Reagendar\n3 - Cancelar',
    '{nome}, lembrete do seu horário de amanhã: {servico} às {hora}. Me avisa:\n1 - Confirmar\n2 - Reagendar\n3 - Cancelar',
  ],

  // Lembrete poucas horas antes
  lembrete1h: [
    'Oi, {nome}! Seu {servico} é daqui a pouco, às {hora}. Te espero! 💅',
    '{nome}, quase na hora! Seu horário de {servico} é às {hora}. Até já! 😊',
    'Olá, {nome}! Lembrando que seu {servico} está marcado pra hoje às {hora}. Nos vemos em breve!',
  ],

  // Resposta quando o cliente escolhe reagendar (opção 2)
  reagendar: [
    'Sem problema, {nome}! Liberei seu horário. Para escolher um novo, é só acessar: {link}',
    'Tranquilo, {nome}! Seu horário foi liberado. Escolha outro melhor pra você aqui: {link}',
    '{nome}, pode deixar! Quando quiser, é só remarcar por este link: {link}',
  ],

  // Resposta quando o cliente confirma (opção 1)
  confirmado: [
    'Perfeito, {nome}! Está confirmado. Até lá! 💅',
    'Maravilha, {nome}! Te espero no horário. 😊',
    'Show, {nome}! Tudo certo então. Até breve!',
  ],

  // Resposta quando o cliente cancela (opção 3)
  cancelado: [
    'Tudo bem, {nome}! Seu horário foi cancelado. Quando quiser, estou por aqui. 💛',
    'Sem problemas, {nome}! Cancelei aqui. Espero te ver numa próxima!',
    '{nome}, cancelamento feito. Qualquer hora que quiser remarcar, é só chamar!',
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
  return texto;
}

module.exports = { montarMensagem, VARIACOES, PADRAO };


