// pausas.js — almoço de cada profissional como bloqueio na agenda Google.
//
// Por que funciona sem travar os outros: o motor calcula os horários livres pelo
// freebusy SÓ da agenda do profissional escolhido (app/server.js, items:
// [{ id: prof.calendar_id }]). Um evento recorrente "Almoço" na agenda da Ana tira
// esse horário só da Ana. O motor não precisa saber de almoço nenhum.
//
// Guardado no dados.json: profissionais[i].pausa = { inicio: "12:00", fim: "13:00",
// evento_id: "<id do evento no Google>" }. Sem `pausa` = sem almoço.
//
// O evento:
//   - recorrente toda semana, só nos dias abertos (complemento de FOLGAS);
//   - opaco (conta como ocupado), sem lembrete (não apita todo dia no celular),
//     cor grafite, marcado com extendedProperties.private.slotme = "pausa";
//   - o dono pode apagar UM dia na agenda para liberar o almoço só naquele dia.

'use strict';
const { getCalendarClient, comRetry, TIMEZONE } = require('./agendas');

const BYDAY = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA']; // 0 = domingo, igual ao FOLGAS do motor

// "0,6" -> [0, 6]. Sem FOLGAS o motor fecha só domingo (app/server.js), então o padrão é '0'.
function lerFolgas(folgas) {
  return String(folgas ?? '0').split(',').map((x) => parseInt(x, 10)).filter((n) => n >= 0 && n <= 6);
}

// Dias abertos no formato do RRULE ("MO,TU,WE,TH,FR,SA"); '' se não abre nenhum dia.
function diasRrule(folgas) {
  const fechados = new Set(lerFolgas(folgas));
  return BYDAY.filter((_, i) => !fechados.has(i)).join(',');
}

// Data de hoje em São Paulo (UTC-3 fixo), "YYYY-MM-DD".
function hojeSP(agora = new Date()) {
  return new Date(agora.getTime() - 3 * 3600000).toISOString().slice(0, 10);
}

function corpoEvento(pausa, folgas, hoje = hojeSP()) {
  return {
    summary: 'Almoço',
    description: 'Bloqueio automático do SlotMe — este horário não aparece para agendamento. '
      + 'Para liberar só um dia, apague a ocorrência daquele dia. Para mudar o horário, fale com o SlotMe.',
    start: { dateTime: `${hoje}T${pausa.inicio}:00`, timeZone: TIMEZONE },
    end: { dateTime: `${hoje}T${pausa.fim}:00`, timeZone: TIMEZONE },
    recurrence: [`RRULE:FREQ=WEEKLY;BYDAY=${diasRrule(folgas)}`],
    transparency: 'opaque',
    reminders: { useDefault: false, overrides: [] },
    colorId: '8',
    extendedProperties: { private: { slotme: 'pausa' } },
  };
}

const sumiu = (e) => [404, 410].includes(e?.code || e?.response?.status);

async function apagarEvento(calendar, calendarId, eventId) {
  try {
    await comRetry(() => calendar.events.delete({ calendarId, eventId, sendUpdates: 'none' }));
  } catch (e) {
    if (!sumiu(e)) throw e; // já não existia: tudo bem
  }
}

async function criarEvento(calendar, calendarId, corpo) {
  const { data } = await comRetry(() => calendar.events.insert({ calendarId, sendUpdates: 'none', requestBody: corpo }));
  return data.id;
}

/**
 * Deixa a agenda Google igual ao almoço da ficha.
 * Muta `dadosDepois` (preenche/atualiza pausa.evento_id); quem chama grava o dados.json.
 *
 * @param {object} dadosAntes   ficha como estava (null num cliente novo)
 * @param {object} dadosDepois  ficha nova
 * @param {object} folgas       { antes, depois } — valor de FOLGAS do .env
 * @param {object} [opts]       { calendar, hoje } — injetáveis nos testes
 * @returns {{criados:string[], alterados:string[], removidos:string[], avisos:string[]}}
 */
async function sincronizarCliente(dadosAntes, dadosDepois, folgas = {}, opts = {}) {
  const r = { criados: [], alterados: [], removidos: [], avisos: [] };
  const profsAntes = (dadosAntes && dadosAntes.profissionais) || [];
  const profsDepois = (dadosDepois && dadosDepois.profissionais) || [];
  const folgasAntes = folgas.antes ?? folgas.depois;
  const folgasDepois = folgas.depois;
  const folgasMudaram = diasRrule(folgasAntes) !== diasRrule(folgasDepois);
  const hoje = opts.hoje || hojeSP();

  // Só abre o cliente do Google se houver algo a fazer (salvar ficha sem almoço não toca no Google).
  const temAlgo = profsAntes.some((p) => p.pausa?.evento_id) || profsDepois.some((p) => p.pausa);
  if (!temAlgo) return r;
  const calendar = opts.calendar || getCalendarClient();

  // Evento de antes, pelo id: onde ele estava e com qual horário.
  const antesPorEvento = new Map();
  for (const p of profsAntes) {
    if (p.pausa?.evento_id) antesPorEvento.set(p.pausa.evento_id, { calendar_id: p.calendar_id, inicio: p.pausa.inicio, fim: p.pausa.fim });
  }

  // 1) Apaga os eventos que saíram da ficha (almoço tirado ou profissional removido).
  const idsDepois = new Set(profsDepois.map((p) => p.pausa?.evento_id).filter(Boolean));
  for (const [id, a] of antesPorEvento) {
    if (idsDepois.has(id) || !a.calendar_id) continue;
    try { await apagarEvento(calendar, a.calendar_id, id); r.removidos.push(id); }
    catch (e) { r.avisos.push(`Não consegui apagar um almoço antigo da agenda: ${e.message}`); }
  }

  // 2) Cria ou atualiza o almoço de cada profissional.
  if (profsDepois.some((p) => p.pausa) && !diasRrule(folgasDepois)) {
    r.avisos.push('Nenhum dia aberto na semana (FOLGAS) — almoço não foi para a agenda.');
    return r;
  }
  for (const p of profsDepois) {
    if (!p.pausa) continue;
    if (!p.calendar_id) {
      r.avisos.push(`${p.nome}: sem agenda Google ainda — o almoço vai para a agenda quando ela existir.`);
      delete p.pausa.evento_id;
      continue;
    }
    const corpo = corpoEvento(p.pausa, folgasDepois, hoje);
    const id = p.pausa.evento_id;
    const antes = id ? antesPorEvento.get(id) : null;
    try {
      if (id && antes && antes.calendar_id === p.calendar_id) {
        const igual = antes.inicio === p.pausa.inicio && antes.fim === p.pausa.fim && !folgasMudaram;
        if (igual) continue;
        try {
          await comRetry(() => calendar.events.patch({ calendarId: p.calendar_id, eventId: id, sendUpdates: 'none', requestBody: corpo }));
          r.alterados.push(p.nome);
        } catch (e) {
          if (!sumiu(e)) throw e;
          p.pausa.evento_id = await criarEvento(calendar, p.calendar_id, corpo); // dono apagou a série
          r.criados.push(p.nome);
        }
      } else {
        // Novo, ou trocou de agenda: o evento antigo (se houver) já saiu no passo 1
        // só se o id sumiu da ficha; aqui o id ainda está, então apaga da agenda velha.
        if (id && antes && antes.calendar_id && antes.calendar_id !== p.calendar_id) {
          await apagarEvento(calendar, antes.calendar_id, id);
          r.removidos.push(id);
        }
        p.pausa.evento_id = await criarEvento(calendar, p.calendar_id, corpo);
        r.criados.push(p.nome);
      }
    } catch (e) {
      r.avisos.push(`${p.nome}: não consegui gravar o almoço na agenda (${e.message}).`);
    }
  }
  return r;
}

module.exports = { sincronizarCliente, corpoEvento, diasRrule, lerFolgas, hojeSP };
