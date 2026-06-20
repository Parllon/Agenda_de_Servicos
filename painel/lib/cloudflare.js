// cloudflare.js — registra DNS + atualiza config + tenta reload do daemon.
// Usado pelo wizard de cadastro ao criar um cliente novo.
//
// Variáveis de ambiente necessárias no .env do painel:
//   CLOUDFLARE_API_TOKEN — token com permissão "DNS:Edit"
//   CLOUDFLARE_ZONE_ID   — Zone ID do domínio agendamentos.app.br
//   CLOUDFLARE_TUNNEL_ID — ID do túnel (d6f1e2aa-...)

'use strict';
const fs = require('fs');
const path = require('path');
const https = require('https');
const { spawn } = require('child_process');
const C = require('./clientes');

const DOMINIO = 'agendamentos.app.br';
const CONFIG_REPO = path.join(C.PROJETO_RAIZ, 'cloudflared_config.yml');
const CONFIG_ETC = '/etc/cloudflared/config.yml';
const CATCH_ALL = '  - service: http_status:404';

// Chama a Cloudflare API (v4).
function cfFetch(method, endpoint, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const opts = {
      hostname: 'api.cloudflare.com',
      path: `/client/v4${endpoint}`,
      method,
      headers: {
        Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN || ''}`,
        'Content-Type': 'application/json',
        ...(data && { 'Content-Length': Buffer.byteLength(data) }),
      },
    };
    const req = https.request(opts, (res) => {
      let buf = '';
      res.on('data', (d) => { buf += d; });
      res.on('end', () => {
        let json;
        try { json = JSON.parse(buf); } catch { return reject(new Error('Resposta inválida da Cloudflare API')); }
        if (!json.success) return reject(new Error(json.errors?.[0]?.message || 'Erro na Cloudflare API'));
        resolve(json.result);
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

// Cria o registro CNAME no DNS da Cloudflare.
async function registrarDNS(slug) {
  const token = process.env.CLOUDFLARE_API_TOKEN;
  const zone = process.env.CLOUDFLARE_ZONE_ID;
  const tunnel = process.env.CLOUDFLARE_TUNNEL_ID;
  if (!token || !zone || !tunnel) {
    throw new Error('CLOUDFLARE_API_TOKEN, CLOUDFLARE_ZONE_ID e CLOUDFLARE_TUNNEL_ID devem estar no .env do painel.');
  }
  await cfFetch('POST', `/zones/${zone}/dns_records`, {
    type: 'CNAME',
    name: `${slug}.${DOMINIO}`,
    content: `${tunnel}.cfargotunnel.com`,
    proxied: true,
    ttl: 1,
  });
}

// Insere nova entrada no YAML de configuração do cloudflared.
function inserirIngress(conteudo, slug, porta) {
  const entrada = `  - hostname: ${slug}.${DOMINIO}\n    service: http://192.168.1.100:${porta}`;
  if (!conteudo.includes(CATCH_ALL)) throw new Error('Catch-all http_status:404 não encontrado no cloudflared_config.yml');
  return conteudo.replace(CATCH_ALL, `${entrada}\n${CATCH_ALL}`);
}

// Atualiza o cloudflared_config.yml do repositório (e /etc/cloudflared/config.yml se acessível).
function atualizarConfig(slug, porta) {
  const orig = fs.readFileSync(CONFIG_REPO, 'utf8');
  fs.writeFileSync(CONFIG_REPO, inserirIngress(orig, slug, porta), 'utf8');

  if (fs.existsSync(CONFIG_ETC)) {
    try {
      const etc = fs.readFileSync(CONFIG_ETC, 'utf8');
      fs.writeFileSync(CONFIG_ETC, inserirIngress(etc, slug, porta), 'utf8');
    } catch { /* sem acesso ao /etc — ignorar */ }
  }
}

// Tenta reiniciar o cloudflared via Docker (funciona se ele rodar como container).
function reloadCloudflared() {
  return new Promise((resolve) => {
    const proc = spawn('docker', ['restart', 'cloudflared'], {
      env: { ...process.env, DOCKER_CONFIG: process.env.DOCKER_CONFIG || '/DATA/.docker' },
    });
    proc.on('error', () => resolve({ ok: false }));
    proc.on('close', (code) => resolve({ ok: code === 0 }));
  });
}

// Ponto de entrada: DNS + config + reload. Nunca lança — retorna resultado parcial.
async function ativarSubdominio(slug, porta) {
  const r = { dns: false, config: false, reload: false, avisos: [] };

  try {
    await registrarDNS(slug);
    r.dns = true;
  } catch (e) {
    r.avisos.push(`DNS: ${e.message}`);
  }

  try {
    atualizarConfig(slug, porta);
    r.config = true;
  } catch (e) {
    r.avisos.push(`Config: ${e.message}`);
  }

  const { ok } = await reloadCloudflared();
  r.reload = ok;
  if (!ok) r.avisos.push('Reload automático falhou — reinicie o cloudflared no ZimaOS manualmente.');

  return r;
}

module.exports = { ativarSubdominio };
