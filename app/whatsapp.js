// whatsapp.js — gateway de WhatsApp com COMPORTAMENTO HUMANO.
// Alterna entre Z-API e Evolution pela variável WHATSAPP_PROVIDER (zapi | evolution).
//
// Camadas anti-bot implementadas:
//   1. Delay aleatório antes de cada envio (pausa "humana")
//   2. Simulação de "digitando..." antes da mensagem
//   3. Envio em lote espaçado (um de cada vez, com intervalo aleatório)
//   4. Variação de texto (ver mensagens.js)
//   5. Respeito a horário comercial (não dispara de madrugada)
//   6. Fila serializada: envios concorrentes saem UM POR VEZ (nunca em rajada)
//   7. Modo central: TODA mensagem é humanizada (o `imediato` é ignorado), pois o
//      número é compartilhado por vários salões e não pode disparar sem pausa.
//
// IMPORTANTE: por causa dos delays, o envio NÃO deve travar a resposta do
// agendamento. No server.js, chame SEM await (fire-and-forget):
//     enviarWhatsapp(tel, msg).catch(() => {});   // <- não use await aqui
// Assim a tela de "confirmado" aparece na hora e a mensagem sai em segundo plano.

const axios = require('axios');

const PROVIDER = (process.env.WHATSAPP_PROVIDER || 'zapi').toLowerCase();

// ---- Modo de WhatsApp (escolhido por cliente no .env) ----
//   proprio (padrão)  -> cada salão usa o PRÓPRIO número (WHATSAPP_INSTANCE)
//   central           -> um único número do SlotMe envia p/ todos (WHATSAPP_INSTANCE_CENTRAL)
// Lidos no carregamento do módulo (o container reinicia ao trocar o .env).
const MODE = (process.env.WHATSAPP_MODE || 'proprio').toLowerCase();
const PREFIXO_ON = String(process.env.WHATSAPP_PREFIXO_NOME || '').toLowerCase() === 'true';

// Qual instância da Evolution usar neste envio. No modo central usa a instância
// única; se ela não estiver configurada, cai na do próprio cliente (à prova de erro).
function instanciaAtiva() {
  if (MODE === 'central') {
    return process.env.WHATSAPP_INSTANCE_CENTRAL || process.env.WHATSAPP_INSTANCE;
  }
  return process.env.WHATSAPP_INSTANCE;
}

// Prefixa "[Label] " na mensagem quando ligado — ajuda o cliente final a saber de
// qual salão é o aviso (essencial no modo central, em que todos recebem do mesmo
// número). O texto vem de WHATSAPP_PREFIXO_LABEL; vazio = usa o slug CLIENTE.
function aplicarPrefixo(mensagem) {
  if (!PREFIXO_ON) return mensagem;
  const label = (process.env.WHATSAPP_PREFIXO_LABEL || process.env.CLIENTE || '').trim();
  return label ? `[${label}] ${mensagem}` : mensagem;
}

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

// ---- Fila global de envio (anti-rajada) ----
// Serializa TODOS os disparos deste processo: imita uma pessoa, que nunca envia
// duas mensagens ao mesmo tempo. Vários agendamentos no mesmo minuto entram em
// fila e saem um por vez — cada um com sua pausa humana. Sem isso, no modo central
// o número compartilhado levaria uma rajada (gatilho clássico de ban).
let cadeiaEnvio = Promise.resolve();

function enfileirar(tarefa) {
  const resultado = cadeiaEnvio.then(tarefa);
  // a fila nunca pode "quebrar" por um erro de envio: encadeia ignorando rejeição.
  cadeiaEnvio = resultado.then(() => {}, () => {});
  return resultado;
}

/** Está dentro do horário comercial de envio? */
function dentroDoHorario(d = new Date()) {
  const h = d.getHours();
  return h >= cfg.horaInicio && h < cfg.horaFim;
}

/** Envia o status "digitando..." (composing). Só faz sentido na Evolution. */
async function enviarPresenca(telefone, ms, instancia = instanciaAtiva()) {
  if (PROVIDER !== 'evolution') return;
  try {
    const base = (process.env.WHATSAPP_API_URL || '').replace(/\/$/, '');
    const url = `${base}/chat/sendPresence/${instancia}`;
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
async function _postEnvio(telefone, mensagem, digitandoMs, instancia = instanciaAtiva()) {
  // Modo central via WAHA (whatsapp-web.js engine WEBJS). Quando WAHA_URL está
  // configurado, todo envio central vai por ele.
  const wahaUrl = process.env.WAHA_URL;
  if (MODE === 'central' && wahaUrl) {
    const session = process.env.WAHA_SESSION || 'agendamento';
    const resp = await axios.post(
      `${wahaUrl.replace(/\/$/, '')}/api/sendText`,
      { chatId: `${telefone}@c.us`, text: mensagem, session },
      {
        headers: { 'Content-Type': 'application/json', 'X-Api-Key': process.env.WAHA_API_KEY || '' },
        timeout: 15000,
      }
    );
    return resp.data;
  }

  let url, payload, headers;

  if (PROVIDER === 'evolution') {
    const base = (process.env.WHATSAPP_API_URL || '').replace(/\/$/, '');
    url = `${base}/message/sendText/${instancia}`;
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
 * @param {string}  [opts.instancia]              - instância a usar (default: instanciaAtiva())
 * @param {boolean} [opts.semPrefixo=false]       - não aplica o prefixo [Label]
 */
async function enviarWhatsapp(telefone, mensagem, opts = {}) {
  if (MODE === 'desativado') {
    return { ok: false, desativado: true };
  }

  if (opts.respeitarHorario && !dentroDoHorario()) {
    console.log('[WhatsApp] fora do horario comercial - envio adiado:', telefone);
    return { ok: false, adiado: true };
  }

  // Instância deste envio: a passada por opts (ex.: avisos à dona) ou a do modo.
  const instancia = opts.instancia || instanciaAtiva();

  // 0. identifica o salão na mensagem quando configurado (modo central).
  // Avisos internos (à dona) pedem semPrefixo: já são obviamente do salão dela.
  if (!opts.semPrefixo) mensagem = aplicarPrefixo(mensagem);

  // No modo central o número é compartilhado: TODA mensagem é humanizada, mesmo as
  // marcadas `imediato` (ex.: aviso à dona). Em modo proprio, `imediato` ainda pula
  // a pausa (o salão usa o próprio número, risco menor).
  const central = MODE === 'central';
  const pularPausa = opts.imediato && !central;

  // Serializa: entra na fila e sai uma por vez, com pausa humana — nunca em rajada.
  return enfileirar(async () => {
    try {
      // 1. pausa humana antes de tudo
      if (!pularPausa) await sleep(randInt(cfg.delayMin, cfg.delayMax));

      // 2. "digitando..." por um tempo aleatório
      const digitandoMs = randInt(cfg.digitandoMin, cfg.digitandoMax);
      await enviarPresenca(telefone, digitandoMs, instancia);

      // 3. envia (na Evolution o próprio delay reforça o "digitando")
      const data = await _postEnvio(telefone, mensagem, digitandoMs, instancia);
      return { ok: true, data };
    } catch (err) {
      // Falha de WhatsApp NUNCA derruba o agendamento (degradação graciosa).
      console.error('[WhatsApp] falha no envio:', err.response?.data || err.message);
      return { ok: false, error: err.message };
    }
  });
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

module.exports = {
  enviarWhatsapp,
  enviarWhatsappLote,
  dentroDoHorario,
  modoWhatsapp: MODE, // 'proprio' | 'central' — consultado pelo server.js no webhook
  instanciaAtiva, // exportado p/ teste e diagnóstico
};
