// whatsapp.js — gateway de WhatsApp com COMPORTAMENTO HUMANO.
// Alterna entre Z-API e Evolution pela variável WHATSAPP_PROVIDER (zapi | evolution).
//
// Camadas anti-bot implementadas:
//   1. Delay aleatório antes de cada envio (pausa "humana")
//   2. Simulação de "digitando..." antes da mensagem
//   3. Envio em lote espaçado (um de cada vez, com intervalo aleatório)
//   4. Variação de texto (ver mensagens.js)
//   5. Respeito a horário comercial (não dispara de madrugada)
//
// IMPORTANTE: por causa dos delays, o envio NÃO deve travar a resposta do
// agendamento. No server.js, chame SEM await (fire-and-forget):
//     enviarWhatsapp(tel, msg).catch(() => {});   // <- não use await aqui
// Assim a tela de "confirmado" aparece na hora e a mensagem sai em segundo plano.

const axios = require('axios');

const PROVIDER = (process.env.WHATSAPP_PROVIDER || 'zapi').toLowerCase();

// ---- Configurações (todas ajustáveis pelo .env, com padrões sensatos) ----
const cfg = {
  // pausa humana ANTES de começar a mandar (ms)
  delayMin: parseInt(process.env.ENVIO_DELAY_MIN_MS || '3000', 10),
  delayMax: parseInt(process.env.ENVIO_DELAY_MAX_MS || '12000', 10),
  // quanto tempo fica "digitando..." (ms)
  digitandoMin: parseInt(process.env.ENVIO_DIGITANDO_MIN_MS || '1500', 10),
  digitandoMax: parseInt(process.env.ENVIO_DIGITANDO_MAX_MS || '4000', 10),
  // intervalo entre mensagens quando manda várias em lote (ms)
  loteMin: parseInt(process.env.ENVIO_LOTE_MIN_MS || '30000', 10),
  loteMax: parseInt(process.env.ENVIO_LOTE_MAX_MS || '120000', 10),
  // janela de horário permitido pra disparar (hora local, 0-23)
  horaInicio: parseInt(process.env.ENVIO_HORA_INICIO || '8', 10),
  horaFim: parseInt(process.env.ENVIO_HORA_FIM || '21', 10),
};

// ---- utilitários ----
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const randInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

/** Está dentro do horário comercial de envio? */
function dentroDoHorario(d = new Date()) {
  const h = d.getHours();
  return h >= cfg.horaInicio && h < cfg.horaFim;
}

/** Envia o status "digitando..." (composing). Só faz sentido na Evolution. */
async function enviarPresenca(telefone, ms) {
  if (PROVIDER !== 'evolution') return;
  try {
    const base = (process.env.WHATSAPP_API_URL || '').replace(/\/$/, '');
    const url = `${base}/chat/sendPresence/${process.env.WHATSAPP_INSTANCE}`;
    await axios.post(
      url,
      { number: telefone, delay: ms, presence: 'composing' },
      {
        headers: { 'Content-Type': 'application/json', apikey: process.env.WHATSAPP_API_TOKEN },
        timeout: 10000,
      }
    );
  } catch (_) {
    // presença é "enfeite": se falhar, ignora e segue pro envio
  }
}

/** Faz a chamada crua de envio (sem delays). Mantém o switch de provider. */
async function _postEnvio(telefone, mensagem, digitandoMs) {
  let url, payload, headers;

  if (PROVIDER === 'evolution') {
    const base = (process.env.WHATSAPP_API_URL || '').replace(/\/$/, '');
    url = `${base}/message/sendText/${process.env.WHATSAPP_INSTANCE}`;
    // 'delay' faz a Evolution mostrar "digitando" por X ms antes de entregar
    payload = { number: telefone, text: mensagem, delay: digitandoMs };
    headers = { 'Content-Type': 'application/json', apikey: process.env.WHATSAPP_API_TOKEN };
  } else {
    url = process.env.WHATSAPP_API_URL;
    payload = { phone: telefone, message: mensagem };
    headers = { 'Content-Type': 'application/json', 'Client-Token': process.env.WHATSAPP_API_TOKEN };
  }

  const resp = await axios.post(url, payload, { headers, timeout: 15000 });
  return resp.data;
}

/**
 * Envia UMA mensagem com comportamento humano.
 * @param {string} telefone - E.164 sem '+': ex. 5521999998888
 * @param {string} mensagem
 * @param {object} [opts]
 * @param {boolean} [opts.imediato=false]         - pula a pausa humana inicial
 * @param {boolean} [opts.respeitarHorario=false] - se true, não envia fora do horário
 */
async function enviarWhatsapp(telefone, mensagem, opts = {}) {
  try {
    if (opts.respeitarHorario && !dentroDoHorario()) {
      console.log('[WhatsApp] fora do horario comercial - envio adiado:', telefone);
      return { ok: false, adiado: true };
    }

    // 1. pausa humana antes de tudo (a não ser que peça imediato)
    if (!opts.imediato) {
      await sleep(randInt(cfg.delayMin, cfg.delayMax));
    }

    // 2. "digitando..." por um tempo aleatório
    const digitandoMs = randInt(cfg.digitandoMin, cfg.digitandoMax);
    await enviarPresenca(telefone, digitandoMs);

    // 3. envia (na Evolution o próprio delay reforça o "digitando")
    const data = await _postEnvio(telefone, mensagem, digitandoMs);
    return { ok: true, data };
  } catch (err) {
    // Falha de WhatsApp NUNCA derruba o agendamento (degradação graciosa).
    console.error('[WhatsApp] falha no envio:', err.response?.data || err.message);
    return { ok: false, error: err.message };
  }
}

/**
 * Envia VÁRIAS mensagens espaçadas no tempo (pro cron de lembretes).
 * Manda uma, espera um intervalo aleatório, manda a próxima — nunca em rajada.
 * @param {Array<{telefone:string, mensagem:string}>} itens
 * @param {object} [opts] - { respeitarHorario }
 * @returns {Promise<Array>} resultado de cada envio
 */
async function enviarWhatsappLote(itens, opts = {}) {
  const resultados = [];
  for (let i = 0; i < itens.length; i++) {
    const { telefone, mensagem } = itens[i];
    const r = await enviarWhatsapp(telefone, mensagem, opts);
    resultados.push({ telefone, ...r });

    // espaça até a próxima (menos depois da última)
    if (i < itens.length - 1) {
      await sleep(randInt(cfg.loteMin, cfg.loteMax));
    }
  }
  return resultados;
}

module.exports = { enviarWhatsapp, enviarWhatsappLote, dentroDoHorario };
