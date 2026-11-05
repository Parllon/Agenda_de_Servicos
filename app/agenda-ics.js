// agenda-ics.js — publica a agenda do salão como "calendário por assinatura" (.ics).
//
// Para quem não usa Google Agenda (ex.: iPhone/iCloud): a pessoa toca num link
// webcal://<cliente>.agendamentos.app.br/agenda/<token>.ics e o iPhone assina
// o calendário. SOMENTE LEITURA.
//
// Fonte = Google Calendar (events.list pela service account), não o SQLite:
// assim aparecem também bloqueios feitos à mão, e cancelamentos somem sozinhos.
//
// Links secretos derivados de AGENDA_ICS_SEGREDO (.env do cliente):
//   dono (todas as agendas):   HMAC(segredo, "todos")
//   profissional N (só a sua): HMAC(segredo, "prof:N")
// Um profissional não chega no link do dono mexendo na URL. Trocar o segredo
// invalida todos os links. O painel calcula o MESMO HMAC (painel/lib/agenda-links.js).

'use strict';
const crypto = require('crypto');

const TAM_TOKEN = 32; // caracteres hex do token (128 bits)

function tokenDe(segredo, alvo) {
  return crypto.createHmac('sha256', segredo).update(String(alvo)).digest('hex').slice(0, TAM_TOKEN);
}

function iguais(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

/**
 * Descobre de quem é o token: { alvo: 'todos' } | { alvo: 'prof', id } | null.
 * @param {string} segredo
 * @param {string} token
 * @param {number[]} idsProfissionais
 */
function resolverToken(segredo, token, idsProfissionais) {
  if (!segredo || !/^[0-9a-f]{32}$/.test(token || '')) return null;
  if (iguais(token, tokenDe(segredo, 'todos'))) return { alvo: 'todos' };
  for (const id of idsProfissionais) {
    if (iguais(token, tokenDe(segredo, `prof:${id}`))) return { alvo: 'prof', id };
  }
  return null;
}

// ---------- Geração do iCalendar (RFC 5545) ----------

function escapar(texto) {
  return String(texto ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

// Linhas de no máximo 75 BYTES; continuação começa com espaço. Corta sem
// quebrar caractere UTF-8 no meio (acentos/emoji ocupam 2-4 bytes).
function dobrar(linha) {
  const partes = [];
  let atual = '';
  let bytes = 0;
  for (const ch of linha) {
    const b = Buffer.byteLength(ch);
    const limite = partes.length ? 74 : 75; // as continuações já têm o espaço
    if (bytes + b > limite) { partes.push(atual); atual = ''; bytes = 0; }
    atual += ch;
    bytes += b;
  }
  partes.push(atual);
  return partes.join('\r\n ');
}

function dataUtc(d) {
  return new Date(d).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

function dataSimples(yyyyMmDd) {
  return String(yyyyMmDd).replace(/-/g, '');
}

/**
 * @param {object} opts
 * @param {string} opts.nome        nome do calendário (aparece no iPhone)
 * @param {Array}  opts.eventos     [{ id, titulo, descricao, inicio, fim, diaInteiro }]
 *                                  inicio/fim: ISO (dateTime) ou YYYY-MM-DD (diaInteiro)
 * @param {string} opts.dominio     para o UID (ex.: bya.agendamentos.app.br)
 */
function montarIcs({ nome, eventos, dominio }) {
  const agora = dataUtc(new Date());
  const linhas = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//SlotMe//Agenda//PT-BR',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapar(nome)}`,
    'X-WR-TIMEZONE:America/Sao_Paulo',
    // Dicas de atualização (iOS/macOS/Outlook respeitam em maior ou menor grau).
    'REFRESH-INTERVAL;VALUE=DURATION:PT15M',
    'X-PUBLISHED-TTL:PT15M',
  ];
  for (const ev of eventos) {
    linhas.push('BEGIN:VEVENT');
    linhas.push(`UID:${escapar(ev.id)}@${dominio}`);
    linhas.push(`DTSTAMP:${agora}`);
    if (ev.diaInteiro) {
      linhas.push(`DTSTART;VALUE=DATE:${dataSimples(ev.inicio)}`);
      linhas.push(`DTEND;VALUE=DATE:${dataSimples(ev.fim)}`);
    } else {
      linhas.push(`DTSTART:${dataUtc(ev.inicio)}`);
      linhas.push(`DTEND:${dataUtc(ev.fim)}`);
    }
    linhas.push(`SUMMARY:${escapar(ev.titulo)}`);
    if (ev.descricao) linhas.push(`DESCRIPTION:${escapar(ev.descricao)}`);
    linhas.push('END:VEVENT');
  }
  linhas.push('END:VCALENDAR');
  return linhas.map(dobrar).join('\r\n') + '\r\n';
}

// ---------- Leitura do Google com cache ----------

const CACHE_MS = 5 * 60 * 1000;
const cache = new Map(); // calendarId -> { em, eventos }

/** Converte um evento do Google no formato do montarIcs. */
function deGoogle(ev, prefixo) {
  const diaInteiro = Boolean(ev.start && ev.start.date);
  return {
    id: ev.id,
    titulo: `${prefixo}${ev.summary || 'Ocupado'}`,
    descricao: ev.description || '',
    inicio: diaInteiro ? ev.start.date : ev.start.dateTime,
    fim: diaInteiro ? ev.end.date : ev.end.dateTime,
    diaInteiro,
  };
}

async function eventosDaAgenda(calendar, calendarId, { desde, ate }) {
  const c = cache.get(calendarId);
  if (c && Date.now() - c.em < CACHE_MS) return c.eventos;
  const eventos = [];
  let pageToken;
  do {
    const { data } = await calendar.events.list({
      calendarId,
      timeMin: desde.toISOString(),
      timeMax: ate.toISOString(),
      singleEvents: true,
      showDeleted: false,
      orderBy: 'startTime',
      maxResults: 2500,
      pageToken,
    });
    for (const ev of data.items || []) {
      if (ev.status === 'cancelled' || !ev.start) continue;
      eventos.push(ev);
    }
    pageToken = data.nextPageToken;
  } while (pageToken);
  cache.set(calendarId, { em: Date.now(), eventos });
  return eventos;
}

function limparCache() { cache.clear(); }

module.exports = { tokenDe, resolverToken, montarIcs, deGoogle, eventosDaAgenda, limparCache, escapar, dobrar };
