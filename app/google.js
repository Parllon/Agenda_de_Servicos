// google.js — cliente autenticado do Google Calendar (Service Account)
const { google } = require('googleapis');
const fs = require('fs');

const credentials = JSON.parse(
  fs.readFileSync(process.env.GOOGLE_CREDENTIALS_PATH, 'utf8')
);

const SCOPES = ['https://www.googleapis.com/auth/calendar'];

// Cache por subject: evita recriar o objeto JWT a cada request.
// O googleapis gerencia a renovação do token OAuth2 internamente.
const _clienteCache = new Map();

/**
 * Retorna um cliente Calendar autenticado.
 * @param {string|null} subject - e-mail a personificar (apenas Domain-Wide Delegation).
 *                                No caminho "agenda compartilhada", passe null.
 */
function getCalendarClient(subject = null) {
  const key = subject || '_default';
  if (!_clienteCache.has(key)) {
    const auth = new google.auth.JWT({
      email: credentials.client_email,
      key: credentials.private_key,
      scopes: SCOPES,
      subject: subject || undefined,
    });
    _clienteCache.set(key, google.calendar({ version: 'v3', auth }));
  }
  return _clienteCache.get(key);
}

module.exports = { getCalendarClient };
