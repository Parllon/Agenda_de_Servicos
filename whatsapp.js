// whatsapp.js — gateway de WhatsApp. Alterna entre Z-API e Evolution API
// pela variável WHATSAPP_PROVIDER (zapi | evolution). Padrão: zapi.
const axios = require('axios');

const PROVIDER = (process.env.WHATSAPP_PROVIDER || 'zapi').toLowerCase();

/**
 * @param {string} telefone - E.164 sem '+': ex. 5521999998888
 * @param {string} mensagem
 */
async function enviarWhatsapp(telefone, mensagem) {
  try {
    let url, payload, headers;

    if (PROVIDER === 'evolution') {
      // Evolution API v2: POST {base}/message/sendText/{instance}
      const base = (process.env.WHATSAPP_API_URL || '').replace(/\/$/, '');
      url = `${base}/message/sendText/${process.env.WHATSAPP_INSTANCE}`;
      payload = { number: telefone, text: mensagem };
      headers = { 'Content-Type': 'application/json', apikey: process.env.WHATSAPP_API_TOKEN };
    } else {
      // Z-API (padrão)
      url = process.env.WHATSAPP_API_URL;
      payload = { phone: telefone, message: mensagem };
      headers = { 'Content-Type': 'application/json', 'Client-Token': process.env.WHATSAPP_API_TOKEN };
    }

    const resp = await axios.post(url, payload, { headers, timeout: 15000 });
    return { ok: true, data: resp.data };
  } catch (err) {
    // Falha de WhatsApp NUNCA derruba o agendamento (degradação graciosa).
    console.error('[WhatsApp] falha no envio:', err.response?.data || err.message);
    return { ok: false, error: err.message };
  }
}

module.exports = { enviarWhatsapp };
