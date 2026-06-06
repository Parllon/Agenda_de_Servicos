// mensagens.js — variações de texto pra cada tipo de mensagem.
// Por que isso existe: mandar SEMPRE a mesma frase é sinal clássico de bot.
// Aqui cada tipo tem várias versões; o sistema sorteia uma a cada envio.
//
// COMO EDITAR: troque/adicione frases nas listas abaixo à vontade.
// Use as chaves entre {} — elas são trocadas pelos dados reais:
//   {nome}        -> primeiro nome do cliente
//   {servico}     -> nome do serviço
//   {profissional}-> nome do profissional
//   {data}        -> data (ex.: 04/06/2026)
//   {hora}        -> horário (ex.: 14:00)
//   {link}        -> link de reagendamento (LANDING_URL)

const VARIACOES = {
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

const randItem = (arr) => arr[Math.floor(Math.random() * arr.length)];

/**
 * Monta uma mensagem sorteando uma das variações e preenchendo os dados.
 * @param {string} tipo  - confirmacao | vespera | lembrete1h | reagendar | confirmado | cancelado
 * @param {object} dados - { nome, servico, profissional, data, hora, link }
 * @returns {string}
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

module.exports = { montarMensagem, VARIACOES };
