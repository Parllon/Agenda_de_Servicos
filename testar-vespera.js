// testar-vespera.js — dispara o lembrete da véspera AGORA, sem esperar as 21h.
// Uso (dentro do container): node testar-vespera.js
// Pré-requisito: ter um agendamento de teste para AMANHÃ.
//
// Usa exatamente a mesma lógica do cron real (montarMensagem + envio em lote
// espaçado), para o teste refletir o que o cliente vai receber de verdade.
require('dotenv').config();
const db = require('./db');
const { enviarWhatsappLote } = require('./whatsapp');
const { montarMensagem } = require('./mensagens');

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

  if (amanha.length === 0) {
    console.log('[TESTE véspera] nada a enviar. Crie um agendamento para amanhã e rode de novo.');
    process.exit(0);
  }

  // Mesma montagem do cron real: texto variado + envio espaçado (anti-rajada).
  const itens = amanha.map((ag) => ({
    _id: ag.id,
    telefone: ag.cliente_telefone,
    mensagem: montarMensagem('vespera', {
      nome: primeiroNome(ag.cliente_nome),
      servico: ag.servico_nome,
      hora: horaLabel(ag.inicio),
    }),
  }));

  itens.forEach((it) => console.log(`  → fila: ${it.telefone}`));

  const resultados = await enviarWhatsappLote(itens);

  resultados.forEach((r, i) => {
    if (r.ok) {
      db.prepare('UPDATE agendamentos SET lembrete_vespera_enviado = 1 WHERE id = ?').run(itens[i]._id);
      console.log(`    ✓ enviado para ${r.telefone}`);
    } else {
      console.log(`    ✗ falhou para ${r.telefone}:`, r.error || r.adiado ? 'adiado/fora de horario' : r.error);
    }
  });

  process.exit(0);
}

processarVespera();