// compartilhar-admin.js — roda UMA vez (ou quando quiser conferir): dá acesso de
// EDIÇÃO ao AGENDAS_ADMIN_EMAIL em todas as agendas que a service account CRIOU
// (clientes do wizard/cadastro automático).
//
// Agendas de clientes antigos (bya, navalha...) são da própria dona, só
// compartilhadas com o bot: essas são PULADAS de propósito — mesmo que o bot
// tenha permissão de gerenciar, a agenda é pessoal dela e não vamos expor.
//
// Uso (no SSH do Zima):
//   sudo env DOCKER_CONFIG=/DATA/.docker docker exec painel-slotme node compartilhar-admin.js
//   (acrescente --simular para só listar o que faria)

'use strict';
require('dotenv').config();
const C = require('./lib/clientes');
const { getCalendarClient, compartilhar, emailAdmin } = require('./lib/agendas');

const SIMULAR = process.argv.includes('--simular');

async function principal() {
  const admin = emailAdmin();
  if (!admin) throw new Error('AGENDAS_ADMIN_EMAIL vazio no .env do painel.');
  const calendar = getCalendarClient();
  const bot = JSON.parse(require('fs').readFileSync(
    process.env.GOOGLE_CREDENTIALS_PATH || require('path').join(C.PROJETO_RAIZ, 'app', 'credentials.json'), 'utf8',
  )).client_email.toLowerCase();

  const resumo = { compartilhadas: 0, jaTinha: 0, puladas: 0, erros: 0 };
  for (const { slug } of C.listar()) {
    let dados;
    try { ({ dados } = C.ler(slug)); } catch (e) { console.log(`- ${slug}: dados ilegíveis (${e.message})`); continue; }
    for (const prof of dados.profissionais || []) {
      const id = prof.calendar_id;
      if (!id) continue;
      const rotulo = `${slug} / ${prof.nome}`;
      // Agenda PRINCIPAL de alguém tem o próprio e-mail como id (ex.: fulana@gmail.com).
      // A SA só cria agendas secundárias (...@group.calendar.google.com).
      if (!/@group\.calendar\.google\.com$/i.test(id)) {
        console.log(`  pulada  ${rotulo} (agenda principal de ${id})`);
        resumo.puladas++; continue;
      }
      let regras;
      try {
        ({ data: { items: regras = [] } } = await calendar.acl.list({ calendarId: id }));
      } catch (e) {
        console.log(`  pulada  ${rotulo} (bot não gerencia esta agenda)`);
        resumo.puladas++; continue;
      }
      // O Google lista a própria agenda como "owner" de si mesma (scope = id da
      // agenda) — isso não é pessoa. Sobrou outro dono além do bot = agenda de alguém.
      const outrosDonos = regras
        .filter((r) => r.role === 'owner' && r.scope.type === 'user')
        .map((r) => r.scope.value.toLowerCase())
        .filter((d) => d !== bot && d !== id.toLowerCase());
      if (outrosDonos.length) {
        console.log(`  pulada  ${rotulo} (agenda pessoal de ${outrosDonos.join(', ')})`);
        resumo.puladas++; continue;
      }
      const atual = regras.find((r) => r.scope.type === 'user' && r.scope.value.toLowerCase() === admin);
      if (atual && ['writer', 'owner'].includes(atual.role)) {
        console.log(`  ok      ${rotulo} (já compartilhada)`);
        resumo.jaTinha++; continue;
      }
      if (SIMULAR) { console.log(`  faria   ${rotulo}`); continue; }
      try {
        await compartilhar(calendar, id, admin);
        console.log(`  feito   ${rotulo}`);
        resumo.compartilhadas++;
      } catch (e) {
        console.log(`  ERRO    ${rotulo}: ${e.message}`);
        resumo.erros++;
      }
    }
  }
  console.log(`\n${SIMULAR ? '[simulação] ' : ''}${admin}:`, JSON.stringify(resumo));
}

principal().catch((e) => { console.error('Falhou:', e.message); process.exit(1); });
