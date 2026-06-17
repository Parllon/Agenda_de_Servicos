// telegram.js — avisos para o salão/profissionais via bot do Telegram.
//
// Como funciona:
// - UM bot por sistema (token em TELEGRAM_BOT_TOKEN no .env do cliente).
// - Cada destinatário é identificado por um "chat id":
//     * por profissional  -> coluna telegram_chat_id (vem do dados.json)
//     * do salão/dona      -> negocio.telegram_chat_id (recebe TODOS os agendamentos)
// - notificar() junta os destinos relevantes, remove repetidos e dispara.
//
// Tudo é "fire-and-forget" no server: uma falha de Telegram NUNCA quebra o
// agendamento. Por isso as funções logam o erro em vez de propagá-lo pra cima.

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;

// Envia uma mensagem a um chat. Sem token ou sem chatId, simplesmente não faz nada
// (cliente que não usa Telegram só deixa o token/ids vazios).
async function enviarTelegram(chatId, texto) {
  if (!TOKEN || !chatId) return;
  const url = `https://api.telegram.org/bot${TOKEN}/sendMessage`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text: texto, parse_mode: 'HTML' }),
  });
  if (!resp.ok) {
    const detalhe = await resp.text().catch(() => '');
    throw new Error(`Telegram ${resp.status}: ${detalhe}`);
  }
}

// Dispara o aviso para o profissional (se tiver chat) E para o salão (se houver),
// sem duplicar quando os dois forem o mesmo chat. Fire-and-forget.
function notificar({ chatProfissional, chatSalao, texto }) {
  const destinos = [...new Set([chatProfissional, chatSalao].filter(Boolean))];
  for (const chatId of destinos) {
    enviarTelegram(chatId, texto).catch((e) =>
      console.error('[telegram] falha ao enviar para', chatId, '-', e.message)
    );
  }
}

// Monta o texto de um aviso a partir dos dados do agendamento.
// tipo: 'novo' | 'cancelado' | 'remarcar'
function montarAviso(tipo, { cliente, servico, profissional, data, hora, telefone }) {
  const cab = {
    novo: '🗓️ <b>Novo agendamento</b>',
    cancelado: '❌ <b>Agendamento cancelado</b>',
    remarcar: '🔄 <b>Horário liberado</b> (cliente vai remarcar)',
  }[tipo] || '<b>Agendamento</b>';

  const linhas = [
    cab,
    '',
    `👤 ${cliente}`,
    `✂️ ${servico}`,
    `🧑‍🔧 ${profissional}`,
    `📅 ${data} às ${hora}`,
  ];
  if (telefone) linhas.push(`📞 ${telefone}`);
  return linhas.join('\n');
}

// Converte o aviso (formatado em HTML p/ Telegram) para o formato do WhatsApp:
// negrito vira *assim* e qualquer outra tag é removida. Permite reusar o MESMO
// montarAviso() nos dois canais sem duplicar o conteúdo.
function htmlParaWhatsapp(html) {
  return html.replace(/<\/?b>/g, '*').replace(/<[^>]+>/g, '');
}

module.exports = { enviarTelegram, notificar, montarAviso, htmlParaWhatsapp };
