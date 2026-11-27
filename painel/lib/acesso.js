// acesso.js — separa o que o painel entrega pela INTERNET do que só entrega na
// REDE LOCAL.
//
// O host cadastro.* passa pelo túnel Cloudflare porque o site SlotMe precisa de
// três rotas. Todo o resto (login, clientes, Docker, métricas, telas) só responde
// para quem acessa pela rede local.
//
// A regra é "fechado por padrão": um pedido só é tratado como local se NÃO tiver
// passado pelo Cloudflare E o Host for um endereço de rede local. Hostname novo
// no túnel já nasce sem acesso à administração.
//
// NÃO usar req.hostname aqui: com `trust proxy` ligado, o Express 4 monta esse
// valor a partir do X-Forwarded-Host, que qualquer visitante pode enviar.

'use strict';

// Únicas rotas liberadas para fora. Método faz parte da regra: POST /api/pedidos
// é o cadastro do site, mas GET /api/pedidos é a lista com dados das pessoas.
const ROTAS_PUBLICAS = [
  { metodos: ['POST', 'OPTIONS'], caminho: /^\/api\/pedidos$/ },
  { metodos: ['GET', 'OPTIONS'], caminho: /^\/api\/pedidos\/[^/]+\/status$/ },
  { metodos: ['POST', 'OPTIONS'], caminho: /^\/api\/evento$/ },
];

// IPv4 privado (RFC 1918) e loopback.
const IPV4_LOCAL = /^(127|10)(\.\d{1,3}){3}$|^192\.168(\.\d{1,3}){2}$|^172\.(1[6-9]|2\d|3[01])(\.\d{1,3}){2}$/;

function semPorta(host) {
  const h = String(host || '').trim().toLowerCase();
  if (h.startsWith('[')) return h.slice(0, h.indexOf(']') + 1); // IPv6: [::1]:8099
  return h.split(':')[0];
}

function ehRedeLocal(req, hostsAdmin) {
  // Cabeçalhos que a borda do Cloudflare coloca em tudo que passa por ela.
  if (req.headers['cf-ray'] || req.headers['cf-connecting-ip']) return false;
  const host = semPorta(req.headers.host);
  return host === 'localhost'
    || host === '[::1]'
    || host.endsWith('.local')
    || IPV4_LOCAL.test(host)
    || hostsAdmin.includes(host);
}

// hostsAdmin: nomes extras que valem como rede local (PAINEL_HOSTS_ADMIN, separados
// por vírgula). Nunca coloque ali um domínio publicado no túnel.
function restringirAcessoPublico({ hostsAdmin = process.env.PAINEL_HOSTS_ADMIN || '' } = {}) {
  const extras = hostsAdmin.split(',').map(semPorta).filter(Boolean);
  return (req, res, next) => {
    if (ehRedeLocal(req, extras)) return next();
    const liberada = ROTAS_PUBLICAS.some(
      (r) => r.metodos.includes(req.method) && r.caminho.test(req.path),
    );
    if (liberada) return next();
    return res.status(404).end(); // 404 (e não 403): não confirma que existe um painel
  };
}

module.exports = { restringirAcessoPublico };
