// scripts/testar-agendas.js — cria 1 agenda de teste e compartilha com um e-mail.
//
// Uso (via docker exec, de fora do container):
//   docker exec -e NODE_PATH=/app/node_modules painel-slotme \
//     node /DATA/Agendamento/scripts/testar-agendas.js seuemail@gmail.com
//   docker exec -e NODE_PATH=/app/node_modules painel-slotme \
//     node /DATA/Agendamento/scripts/testar-agendas.js --delete <calendarId>
//
// O NODE_PATH é necessário porque este script roda a partir do volume
// montado do projeto (/DATA/Agendamento), não de dentro da imagem (/app) —
// e é só dentro da imagem que `npm install` deixou o googleapis instalado.
// Sem isso, o require('googleapis') em painel/lib/agendas.js falha com
// "Cannot find module 'googleapis'".
const { getCalendarClient } = require('../painel/lib/agendas');

async function main() {
  const [arg1, arg2] = process.argv.slice(2);
  const calendar = getCalendarClient();

  if (arg1 === '--delete') {
    if (!arg2) { console.error('Uso: node scripts/testar-agendas.js --delete <calendarId>'); process.exit(1); }
    await calendar.calendars.delete({ calendarId: arg2 });
    console.log(`Apagada: ${arg2}`);
    return;
  }

  const email = arg1;
  if (!email) { console.error('Uso: node scripts/testar-agendas.js seuemail@gmail.com'); process.exit(1); }

  const { data } = await calendar.calendars.insert({
    requestBody: { summary: 'SlotMe — Teste', timeZone: 'America/Sao_Paulo' },
  });
  console.log('Agenda criada:', data.id);

  await calendar.acl.insert({
    calendarId: data.id,
    sendNotifications: true,
    requestBody: { role: 'writer', scope: { type: 'user', value: email } },
  });
  console.log(`Compartilhada com ${email}. Confira o convite no Google Calendar.`);
  console.log(`Pra apagar depois: node scripts/testar-agendas.js --delete ${data.id}`);
}

main().catch((e) => { console.error('Erro:', e.message); process.exit(1); });
