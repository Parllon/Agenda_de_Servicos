// agendas.js — cria e compartilha agendas Google Calendar via service account,
// para o modelo "a SA cria e compartilha com o dono" (clientes novos).
// Duplica a autenticação de app/google.js de propósito: painel e motor são
// serviços/containers separados, não compartilham require().

const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');
const C = require('./clientes');

const CREDENTIALS_PATH = process.env.GOOGLE_CREDENTIALS_PATH
  || path.join(C.PROJETO_RAIZ, 'app', 'credentials.json');
const SCOPES = ['https://www.googleapis.com/auth/calendar'];
const TIMEZONE = 'America/Sao_Paulo';

let _client = null;
function getCalendarClient() {
  if (!_client) {
    const credentials = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, 'utf8'));
    const auth = new google.auth.JWT({
      email: credentials.client_email,
      key: credentials.private_key,
      scopes: SCOPES,
    });
    _client = google.calendar({ version: 'v3', auth });
  }
  return _client;
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// Google bloqueia rajadas de criação (403/429) — retry com backoff, 3 tentativas.
async function comRetry(fn) {
  for (let i = 0; i < 3; i++) {
    try { return await fn(); }
    catch (e) {
      const status = e?.code || e?.response?.status;
      if (![403, 429].includes(status) || i === 2) throw e;
      await sleep(2000 * (i + 1));
    }
  }
}

async function criarAgenda(calendar, summary) {
  const { data } = await comRetry(() => calendar.calendars.insert({
    requestBody: { summary, timeZone: TIMEZONE },
  }));
  return data.id;
}

async function compartilhar(calendar, calendarId, email) {
  await comRetry(() => calendar.acl.insert({
    calendarId,
    sendNotifications: true,
    requestBody: { role: 'writer', scope: { type: 'user', value: email } }, // NUNCA 'owner'
  }));
}

// Idempotente: só cria o que falta (calendar_id vazio). Para no primeiro erro
// e informa exatamente o que foi criado, o que já existia e o que não deu.
// Muta `dados` em memória (preenche calendar_id); quem chama decide se/quando
// persiste no dados.json.
async function criarAgendasDoCliente(dados) {
  const emailDono = (dados.negocio?.email_dono || '').trim();
  if (!emailDono) {
    throw new Error('negocio.email_dono é obrigatório para criar agendas automaticamente.');
  }
  const calendar = getCalendarClient();
  const resultado = { criadas: [], jaExistiam: [], naoTentadas: [], erros: [] };
  const profs = dados.profissionais || [];

  let interrompido = false;
  for (const prof of profs) {
    if (interrompido) { resultado.naoTentadas.push(prof.nome); continue; }
    if (prof.calendar_id) {
      resultado.jaExistiam.push({ profissional: prof.nome, calendar_id: prof.calendar_id });
      continue;
    }
    try {
      const id = await criarAgenda(calendar, `${dados.negocio.nome} — ${prof.nome}`);
      await compartilhar(calendar, id, emailDono);
      if (prof.email) await compartilhar(calendar, id, prof.email);
      prof.calendar_id = id;
      resultado.criadas.push({ profissional: prof.nome, calendar_id: id });
    } catch (e) {
      resultado.erros.push({ profissional: prof.nome, erro: e.message });
      interrompido = true; // informa o que faltou em vez de tentar o resto às cegas
    }
  }

  return resultado;
}

module.exports = { getCalendarClient, criarAgendasDoCliente };
