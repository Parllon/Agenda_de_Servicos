// google.js — cliente autenticado do Google Calendar (Service Account)
const { google } = require('googleapis');
const fs = require('fs');

const credentials = JSON.parse(
  fs.readFileSync(process.env.GOOGLE_CREDENTIALS_PATH, 'utf8')
);

const SCOPES = ['https://www.googleapis.com/auth/calendar'];

/**
 * Retorna um cliente Calendar autenticado.
 * @param {string|null} subject - e-mail a personificar (apenas Domain-Wide Delegation).
 *                                No caminho "agenda compartilhada", passe null.
 */
function getCalendarClient(subject = null) {
  const auth = new google.auth.JWT({
    email: credentials.client_email,
    key: credentials.private_key,
    scopes: SCOPES,
    subject: subject || undefined,
  });
  return google.calendar({ version: 'v3', auth });
}

module.exports = { getCalendarClient };
