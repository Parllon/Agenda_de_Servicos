// cron-lembretes.js — roda em processo separado.
// Dois lembretes independentes:
//   1) Relativo: X minutos antes do horário (ANTECEDENCIA_MIN, padrão 60).
//   2) Véspera:  todo dia num horário fixo (LEMBRETE_VESPERA_HORA, padrão 21h),
//                confirmando os agendamentos do DIA SEGUINTE.
require('dotenv').config();
const cron = require('node-cron');
const db = require('./db');
const { enviarWhatsapp } = require('./whatsapp');

const TZ = process.env.TIMEZONE || 'America/Sao_Paulo';
const OFFSET = process.env.TIMEZONE_OFFSET || '-03:00';
const ANTECEDENCIA_MIN = parseInt(process.env.ANTECEDENCIA_MIN || '60', 10);
const TOLERANCIA_MIN = 15; // metade do intervalo do cron (30/2)
const VESPERA_HORA = parseInt(process.env.LEMBRETE_VESPERA_HORA || '21', 10);

const horaLabel = (iso) =>
  new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: TZ });
const primeiroNome = (nome) => nome.trim().split(/\s+/)[0];

// ===================== 1) LEMBRETE RELATIVO (X min antes) =====================
async function processarLembretes() {
  const agora = new Date();
  const janelaInicio = new Date(agora.getTime() + (ANTECEDENCIA_MIN - TOLERANCIA_MIN) * 60000);
  const janelaFim = new Date(agora.getTime() + (ANTECEDENCIA_MIN + TOLERANCIA_MIN) * 60000);

  const pendentes = db
    .prepare(
      `SELECT * FROM agendamentos
       WHERE status = 'confirmado'
         AND lembrete_enviado = 0
         AND inicio >= ?
         AND inicio <= ?`
    )
    .all(janelaInicio.toISOString(), janelaFim.toISOString());

  console.log(`[cron:relativo] ${new Date().toISOString()} — ${pendentes.length} lembrete(s)`);

  for (const ag of pendentes) {
    const msg =
      `Olá ${primeiroNome(ag.cliente_nome)}! Lembrete: seu ${ag.servico_nome} é hoje às ${horaLabel(ag.inicio)}. 💅\n` +
      `Te esperamos!`;
    const r = await enviarWhatsapp(ag.cliente_telefone, msg);
    if (r.ok) {
      db.prepare('UPDATE agendamentos SET lembrete_enviado = 1 WHERE id = ?').run(ag.id);
    }
  }
}

// ===================== 2) LEMBRETE DA VÉSPERA (horário fixo) =====================
async function processarVespera() {
  // Calcula o intervalo "amanhã" no fuso de São Paulo, independente do fuso do servidor.
  const hojeStrSP = new Date().toLocaleDateString('en-CA', { timeZone: TZ }); // YYYY-MM-DD
  const hojeSP = new Date(`${hojeStrSP}T00:00:00${OFFSET}`);
  const amanhaInicio = new Date(hojeSP.getTime() + 24 * 3600 * 1000); // amanhã 00:00 SP
  const amanhaFim = new Date(amanhaInicio.getTime() + 24 * 3600 * 1000); // depois 00:00 SP

  const amanha = db
    .prepare(
      `SELECT * FROM agendamentos
       WHERE status = 'confirmado'
         AND lembrete_vespera_enviado = 0
         AND inicio >= ?
         AND inicio < ?`
    )
    .all(amanhaInicio.toISOString(), amanhaFim.toISOString());

  console.log(`[cron:vespera] ${new Date().toISOString()} — ${amanha.length} confirmação(ões)`);

  for (const ag of amanha) {
    const msg =
      `Olá ${primeiroNome(ag.cliente_nome)}! Amanhã você tem ${ag.servico_nome} às ${horaLabel(ag.inicio)}. 💅\n` +
      `Podemos confirmar? Responda *1* para Confirmar ou *2* para Cancelar.`;
    const r = await enviarWhatsapp(ag.cliente_telefone, msg);
    if (r.ok) {
      db.prepare('UPDATE agendamentos SET lembrete_vespera_enviado = 1 WHERE id = ?').run(ag.id);
    }
  }
}

// ===================== AGENDAMENTOS DO CRON =====================
// Lembrete relativo: a cada 30 minutos
cron.schedule('*/30 * * * *', processarLembretes, { timezone: TZ });

// Lembrete da véspera: todo dia às VESPERA_HORA:00 (fuso de SP)
cron.schedule(`0 ${VESPERA_HORA} * * *`, processarVespera, { timezone: TZ });

console.log(
  `Cron iniciado — relativo: ${ANTECEDENCIA_MIN}min antes (*/30) | véspera: ${VESPERA_HORA}:00 diário.`
);

// Execução imediata do relativo ao subir (a véspera só roda no horário marcado)
processarLembretes();