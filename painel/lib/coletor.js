// coletor.js — rota pública POST /api/evento (eventos das landing pages e do site SlotMe).
//
// Fica num Router separado do server.js para poder ser testada sozinha
// (__tests__/coletor.test.js).
//
// Corpo aceito:
//   - application/json (sites antigos; passa por preflight de CORS → OPTIONS abaixo);
//   - text/plain contendo JSON (site novo: "simple request", sem preflight — e é o
//     que o navigator.sendBeacon consegue mandar entre domínios).
// Token: cabeçalho X-Metrics-Token OU campo _token do corpo.
// Campos: slug, sessaoId, tipo e, opcionais, utm_source / utm_medium / utm_campaign.

const express = require('express');
const cors = require('cors');
const M = require('./metricas');

const SESSAO_OK = /^[A-Za-z0-9_-]{1,64}$/;

function criarColetor({ token = process.env.METRICS_TOKEN || '', limite = null } = {}) {
  const router = express.Router();
  const corsEvento = cors({
    methods: ['POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'X-Metrics-Token'],
    maxAge: 86400,
  });
  const semLimite = (req, res, next) => next();

  router.options('/api/evento', corsEvento);
  router.post(
    '/api/evento',
    corsEvento,
    limite || semLimite,
    express.json({ limit: '2kb' }),                       // pula se o parser global já leu
    express.text({ type: 'text/plain', limit: '2kb' }),
    (req, res) => {
      let corpo = req.body;
      if (typeof corpo === 'string') {
        try { corpo = JSON.parse(corpo); } catch { return res.status(400).end(); }
      }
      if (!corpo || typeof corpo !== 'object' || Array.isArray(corpo)) return res.status(400).end();

      const recebido = req.headers['x-metrics-token'] || corpo._token || '';
      if (!token || recebido !== token) return res.status(403).end();

      const { slug, sessaoId, tipo } = corpo;
      if (!M.TIPOS_EVENTO.has(tipo)) return res.status(400).end();
      if (typeof sessaoId !== 'string' || !SESSAO_OK.test(sessaoId)) return res.status(400).end();
      if (!M.slugValido(slug)) return res.status(400).end();

      try {
        M.inserirLpEvento(slug, sessaoId, tipo, corpo);
      } catch (e) {
        console.error('[metricas/evento]', e.message);
      }
      res.json({ ok: true });
    },
  );

  // Corpo grande demais / JSON quebrado: 400/413 silenciosos (é rota pública).
  router.use('/api/evento', (err, req, res, next) => {
    res.status(err.status && err.status < 500 ? err.status : 400).end();
  });

  return router;
}

module.exports = { criarColetor };
