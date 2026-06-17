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
// Sem dependências: só módulos nativos (http, fs, path). Roda na imagem única
// motor-agendamento:v1 com `command: node webhook-dispatcher.js`, na rede
// agenda-net, alcançando os containers pelo nome <CLIENTE>-app:3000.
//
// Configurar o webhook da instância central UMA vez (apontando pra cá):
//   curl -X POST http://localhost:8080/webhook/set/slotme_central \
//     -H "apikey: <EVOLUTION_API_KEY>" -H "Content-Type: application/json" \
//     -d '{"webhook":{"url":"http://webhook-dispatcher:3000/webhook-whatsapp","events":["MESSAGES_UPSERT"]}}'

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = parseInt(process.env.DISPATCH_PORT || '3000', 10);
const CLIENTES_DIR = process.env.CLIENTES_DIR || '/clientes';
const PORTA_INTERNA = parseInt(process.env.ALVO_PORTA || '3000', 10); // porta interna dos apps
const TIMEOUT_MS = parseInt(process.env.DISPATCH_TIMEOUT_MS || '8000', 10);

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
function alvosCentral() {
  let pastas;
  try {
    pastas = fs.readdirSync(CLIENTES_DIR, { withFileTypes: true });
  } catch (e) {
    console.error('[dispatcher] não consegui ler', CLIENTES_DIR, '-', e.message);
    return [];
  }
  const alvos = [];
  for (const d of pastas) {
    if (!d.isDirectory() || d.name === '_template') continue;
    const env = lerEnv(path.join(CLIENTES_DIR, d.name, '.env'));
    if ((env.WHATSAPP_MODE || '').toLowerCase() !== 'central') continue;
    const slug = env.CLIENTE || d.name; // CLIENTE == slug == nome do container
    alvos.push({ slug, host: `${slug}-app` });
  }
  return alvos;
}

// ---- Repassa o corpo cru pro /webhook-whatsapp de um container. Fire-and-forget:
//      qualquer erro só loga e NUNCA derruba o fan-out dos demais. ----
function repassar(alvo, corpo) {
  const req = http.request(
    {
      host: alvo.host,
      port: PORTA_INTERNA,
      path: '/webhook-whatsapp',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(corpo),
      },
      timeout: TIMEOUT_MS,
    },
    (resp) => {
      resp.resume(); // descarta a resposta; só nos importa que chegou
      console.log(`[dispatcher] -> ${alvo.slug} (${resp.statusCode})`);
    }
  );
  req.on('timeout', () => {
    console.error(`[dispatcher] timeout -> ${alvo.slug}`);
    req.destroy();
  });
  req.on('error', (e) => console.error(`[dispatcher] falha -> ${alvo.slug}: ${e.message}`));
  req.end(corpo);
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
    console.log(`[dispatcher] repassando p/ ${alvos.length} alvo(s):`, alvos.map((a) => a.slug).join(', '));
    for (const alvo of alvos) repassar(alvo, corpo);
  });
});

server.listen(PORT, () => console.log(`[dispatcher] ouvindo na porta ${PORT}; clientes em ${CLIENTES_DIR}`));
