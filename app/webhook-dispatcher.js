// webhook-dispatcher.js — FAN-OUT do webhook da instância CENTRAL do SlotMe.
//
// Problema que resolve: no modo central, um único número do SlotMe (instância
// `slotme_central` na Evolution) atende vários salões. Mas essa instância só tem
// UM webhook URL, enquanto cada cliente tem o seu próprio container/banco. Quando
// uma cliente responde "1/2/3", a Evolution não sabe sozinha pra qual container
// mandar. Este dispatcher recebe esse webhook e REPASSA pra todos os containers
// em modo central; cada um busca o telefone no SEU banco e só o DONO responde
// (os demais ficam em silêncio — ver a blindagem em server.js).
//
// Exceção — "2" (reagendar) e "3" (cancelar): antes de repassar, pergunta a cada
// salão quais horários pendentes o remetente tem. Com dois ou mais, não repassa
// (cada salão cancelaria o seu): pede a UM deles que envie a lista ao cliente.
//
// Cada chamada leva o WEBHOOK_TOKEN do .env daquele salão (cabeçalho
// X-Webhook-Token); sem ele o salão responde 403.
//
// Sem dependências: só módulos nativos (http, fs, path). Roda na imagem única
// motor-agendamento:v1 com `command: node webhook-dispatcher.js`, na rede
// agenda-net, alcançando os containers pelo nome <CLIENTE>-app:3000.
//
// Configurar o webhook da instância central UMA vez (apontando pra cá):
//   curl -X POST http://localhost:8080/webhook/set/agendamento \
//     -H "apikey: <EVOLUTION_API_KEY>" -H "Content-Type: application/json" \
//     -d '{"webhook":{"url":"http://webhook-dispatcher:3000/webhook-whatsapp","events":["MESSAGES_UPSERT"]}}'

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = parseInt(process.env.DISPATCH_PORT || '3000', 10);
const CLIENTES_DIR = process.env.CLIENTES_DIR || '/clientes';
const PORTA_INTERNA = parseInt(process.env.ALVO_PORTA || '3000', 10); // porta interna dos apps
const TIMEOUT_MS = parseInt(process.env.DISPATCH_TIMEOUT_MS || '8000', 10);
// /ambiguo só responde depois de enviar a mensagem (pausa "humana" + fila do salão).
const TIMEOUT_AVISO_MS = parseInt(process.env.DISPATCH_AVISO_TIMEOUT_MS || '60000', 10);

// ---- Lê uma chave de um arquivo .env, ignorando comentário inline (mesma ideia
//      do parse do painel: "valor   # comentário" -> "valor"). ----
function lerEnv(arquivo) {
  const out = {};
  let texto;
  try {
    texto = fs.readFileSync(arquivo, 'utf8');
  } catch (_) {
    return out;
  }
  for (const linha of texto.split(/\r?\n/)) {
    const limpa = linha.trim();
    if (!limpa || limpa.startsWith('#')) continue;
    const igual = linha.indexOf('=');
    if (igual === -1) continue;
    const chave = linha.slice(0, igual).trim();
    const valor = linha.slice(igual + 1).replace(/\s+#.*$/, '').trim();
    out[chave] = valor;
  }
  return out;
}

// ---- Descobre os containers-alvo: varre clientes/*/.env e fica só com os que
//      estão em WHATSAPP_MODE=central. Lido a cada mensagem (são poucos arquivos
//      pequenos), então ativar um cliente é só editar o .env dele — sem reiniciar
//      o dispatcher. ----
function alvosCentral(dir = CLIENTES_DIR) {
  let pastas;
  try {
    pastas = fs.readdirSync(dir, { withFileTypes: true });
  } catch (e) {
    console.error('[dispatcher] não consegui ler', dir, '-', e.message);
    return [];
  }
  const alvos = [];
  for (const d of pastas) {
    if (!d.isDirectory() || d.name === '_template') continue;
    const env = lerEnv(path.join(dir, d.name, '.env'));
    if ((env.WHATSAPP_MODE || '').toLowerCase() !== 'central') continue;
    const slug = env.CLIENTE || d.name; // CLIENTE == slug == nome do container
    const token = env.WEBHOOK_TOKEN || '';
    if (!token) console.warn(`[dispatcher] ${slug}: sem WEBHOOK_TOKEN no .env — o salão vai recusar as respostas`);
    alvos.push({ slug, host: `${slug}-app`, porta: PORTA_INTERNA, token });
  }
  return alvos;
}

// ---- POST para um container de cliente, com a senha dele. ----
function enviarHttp(alvo, caminho, corpo) {
  return new Promise((resolve, reject) => {
    const headers = { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(corpo) };
    if (alvo.token) headers['X-Webhook-Token'] = alvo.token;
    const timeout = caminho === '/webhook-whatsapp/ambiguo' ? TIMEOUT_AVISO_MS : TIMEOUT_MS;
    const req = http.request(
      { host: alvo.host, port: alvo.porta, path: caminho, method: 'POST', headers, timeout },
      (resp) => {
        let texto = '';
        resp.setEncoding('utf8');
        resp.on('data', (c) => { texto += c; });
        resp.on('end', () => resolve({ status: resp.statusCode, corpo: texto }));
        resp.on('error', reject);
      }
    );
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.end(corpo);
  });
}

// ---- Repassa o corpo cru pro /webhook-whatsapp de um container. Qualquer erro só
//      loga e NUNCA derruba o fan-out dos demais. ----
async function repassar(alvo, corpo, enviar) {
  try {
    const { status } = await enviar(alvo, '/webhook-whatsapp', corpo);
    console.log(`[dispatcher] -> ${alvo.slug} (${status})`);
  } catch (e) {
    console.error(`[dispatcher] falha -> ${alvo.slug}: ${e.message}`);
  }
}

// ---- Remetente de uma mensagem recebida "2" ou "3" (as respostas que cancelam);
//      null para todo o resto, que é repassado direto. ----
function remetenteQueCancela(corpo) {
  try {
    const dados = JSON.parse(corpo);
    const { from, body, fromMe } = dados.payload || {};
    if (String(dados.event || '').toLowerCase() !== 'message' || fromMe) return null;
    if (typeof body !== 'string' || !['2', '3'].includes(body.trim())) return null;
    return String(from || '') || null;
  } catch (_) {
    return null;
  }
}

// ---- Horários pendentes do remetente num salão; null = salão sem resposta. ----
async function consultarPendentes(alvo, from, enviar) {
  try {
    const { status, corpo } = await enviar(alvo, '/webhook-whatsapp/pendentes', JSON.stringify({ from }));
    if (status !== 200) throw new Error(`HTTP ${status}`);
    const dados = JSON.parse(corpo);
    if (!Array.isArray(dados?.horarios)) throw new Error('resposta em formato inesperado');
    const itens = dados.horarios.map((h) => ({
      salao: dados.salao, contato: dados.contato, inicio: h.inicio, servico: h.servico,
    }));
    return { alvo, itens };
  } catch (e) {
    // Decide com os demais: um salão parado não pode travar o cancelamento de todos.
    console.error(`[dispatcher] ${alvo.slug}: sem resposta à consulta de pendentes (${e.message})`);
    return null;
  }
}

// ---- Pede a um salão que envie a lista; se falhar, tenta o próximo. ----
async function avisarAmbiguidade(comHorario, from, itens, enviar) {
  const corpo = JSON.stringify({ from, itens });
  for (const { alvo } of comHorario) {
    try {
      const { status } = await enviar(alvo, '/webhook-whatsapp/ambiguo', corpo);
      if (status === 200) {
        console.log(`[dispatcher] lista enviada por ${alvo.slug}`);
        return;
      }
      console.error(`[dispatcher] ${alvo.slug}: não enviou a lista (HTTP ${status})`);
    } catch (e) {
      console.error(`[dispatcher] ${alvo.slug}: não enviou a lista (${e.message})`);
    }
  }
  console.error('[dispatcher] nenhum salão enviou a lista; nada foi cancelado');
}

// ---- Decide o que fazer com uma mensagem recebida do WhatsApp. ----
async function tratarWebhook(corpo, alvos, enviar = enviarHttp) {
  const from = remetenteQueCancela(corpo);
  if (from) {
    const respostas = await Promise.all(alvos.map((a) => consultarPendentes(a, from, enviar)));
    const comHorario = respostas.filter((r) => r && r.itens.length > 0);
    const itens = comHorario
      .flatMap((r) => r.itens)
      .sort((a, b) => Date.parse(a.inicio) - Date.parse(b.inicio));
    if (itens.length > 1) {
      console.log(`[dispatcher] ${itens.length} horários pendentes: resposta não repassada`);
      await avisarAmbiguidade(comHorario, from, itens, enviar);
      return;
    }
  }
  console.log(`[dispatcher] repassando p/ ${alvos.length} alvo(s):`, alvos.map((a) => a.slug).join(', '));
  await Promise.all(alvos.map((a) => repassar(a, corpo, enviar)));
}

const server = http.createServer((req, res) => {
  // Healthcheck simples (útil pra `docker ps`/curl interno).
  if (req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('webhook-dispatcher ok\n');
    return;
  }
  if (req.method !== 'POST' || req.url !== '/webhook-whatsapp') {
    res.writeHead(404);
    res.end();
    return;
  }

  let corpo = '';
  req.on('data', (c) => {
    corpo += c;
    if (corpo.length > 1e6) req.destroy(); // guarda contra payload absurdo
  });
  req.on('end', () => {
    // Responde 200 NA HORA pra Evolution não reenviar em loop; o fan-out segue async.
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('{"ok":true}');

    const alvos = alvosCentral();
    if (!alvos.length) {
      console.log('[dispatcher] nenhum cliente em modo central — nada a repassar');
      return;
    }
    tratarWebhook(corpo, alvos).catch((e) => console.error('[dispatcher] erro:', e.message));
  });
});

if (require.main === module) {
  server.listen(PORT, () => console.log(`[dispatcher] ouvindo na porta ${PORT}; clientes em ${CLIENTES_DIR}`));
}

module.exports = { alvosCentral, enviarHttp, tratarWebhook };
