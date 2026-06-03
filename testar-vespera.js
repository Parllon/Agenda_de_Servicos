// testar-vespera.js — dispara o lembrete da véspera AGORA, sem esperar as 21h.
// Uso (dentro do container): node testar-vespera.js
// Pré-requisito: ter um agendamento de teste para AMANHÃ.
require('dotenv').config();
const db = require('./db');
const { enviarWhatsapp } = require('./whatsapp');

const TZ = process.env.TIMEZONE || 'America/Sao_Paulo';
const OFFSET = process.env.TIMEZONE_OFFSET || '-03:00';

const horaLabel = (iso) =>
  new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: TZ });
const primeiroNome = (nome) => nome.trim().split(/\s+/)[0];

async function processarVespera() {
  const hojeStrSP = new Date().toLocaleDateString('en-CA', { timeZone: TZ });
  const hojeSP = new Date(`${hojeStrSP}T00:00:00${OFFSET}`);
  const amanhaInicio = new Date(hojeSP.getTime() + 24 * 3600 * 1000);
  const amanhaFim = new Date(amanhaInicio.getTime() + 24 * 3600 * 1000);

  const amanha = db
    .prepare(
      `SELECT * FROM agendamentos
       WHERE status = 'confirmado'
         AND lembrete_vespera_enviado = 0
         AND inicio >= ?
         AND inicio < ?`
    )
    .all(amanhaInicio.toISOString(), amanhaFim.toISOString());

  console.log(`[TESTE véspera] janela: ${amanhaInicio.toISOString()} → ${amanhaFim.toISOString()}`);
  console.log(`[TESTE véspera] ${amanha.length} agendamento(s) encontrado(s) para amanhã.`);

  for (const ag of amanha) {
    const msg =
      `Olá ${primeiroNome(ag.cliente_nome)}! Amanhã você tem ${ag.servico_nome} às ${horaLabel(ag.inicio)}. 💅\n` +
      `Responda *1* para Confirmar, *2* para Reagendar ou *3* para Cancelar.`;
    console.log(`  → enviando para ${ag.cliente_telefone} (${ag.cliente_nome})`);
    const r = await enviarWhatsapp(ag.cliente_telefone, msg);
    if (r.ok) {
      db.prepare('UPDATE agendamentos SET lembrete_vespera_enviado = 1 WHERE id = ?').run(ag.id);
      console.log('    ✓ enviado');
    } else {
      console.log('    ✗ falhou:', r.error);
    }
  }
  process.exit(0);
}

processarVespera();