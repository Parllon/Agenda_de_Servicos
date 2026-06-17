// server.js — API REST + serve a landing page (public/)
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const fs = require('fs');
const db = require('./db');
const { getCalendarClient } = require('./google');
const { enviarWhatsapp, modoWhatsapp } = require('./whatsapp');
const { montarMensagem } = require('./mensagens');
const { notificar, montarAviso, htmlParaWhatsapp } = require('./telegram');
const { TEMAS, PERFIS, cssVars } = require('./temas');
const { gerarSlotsDoDia: _gerarSlots } = require('./utils');

const app = express();

// Atrás do Cloudflare Tunnel / proxy reverso: confia no 1º proxy para o rate-limit
// enxergar o IP real do cliente (e não o IP interno do túnel).
app.set('trust proxy', 1);

// --- Cabeçalhos de segurança ---
// Mantém a CDN do Tailwind e as fontes do Google funcionando na landing.
app.use(
  helmet({
    contentSecurityPolicy: false, // a landing usa CDN/inline; CSP exigiria ajuste fino
    crossOriginEmbedderPolicy: false,
  })
);

// --- CORS restrito ---
// Domínio(s) liberado(s) via .env: CORS_ORIGIN=https://agendar.seudominio.com.br
// Vários domínios separados por vírgula. Vazio = libera tudo (use só em dev/local).
const ORIGENS = (process.env.CORS_ORIGIN || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
app.use(
  cors({
    origin: ORIGENS.length ? ORIGENS : true,
  })
);

app.use(express.json({ limit: '10kb' })); // corpo pequeno; agendamento não precisa de mais

// --- Tema + identidade do negócio ---
// TEMA (visual) vem do .env. A identidade (nome/subtítulo/cidade) vem do dados.json
// — a MESMA ficha que o seed.js usa. Assim cada cliente tem um arquivo só de config.
const TEMA = TEMAS[process.env.TEMA] ? process.env.TEMA : 'tema_1';
const tema = TEMAS[TEMA];
// Perfil de profissional: independente do tema; fallback para os rótulos do tema.
const PERFIL = PERFIS[process.env.PERFIL_PROFISSIONAL] || tema.rotulos;

let negocioJson = {};
try {
  const cam = process.env.CAMINHO_DADOS_JSON;
  if (cam && fs.existsSync(cam)) {
    negocioJson = JSON.parse(fs.readFileSync(cam, 'utf8')).negocio || {};
  }
} catch (e) {
  console.error('Aviso: não consegui ler a identidade do dados.json:', e.message);
}

// Precedência: dados.json -> .env (override opcional) -> padrão.
const NEGOCIO = {
  nome: negocioJson.nome || process.env.NEGOCIO_NOME || 'Bya Marcondes',
  subtitulo: negocioJson.subtitulo || process.env.NEGOCIO_SUBTITULO || 'Nail Designer',
  cidade: negocioJson.cidade || process.env.NEGOCIO_CIDADE || 'Rio de Janeiro',
};

// Permite o cliente final escolher até 2 serviços na mesma marcação. Liga/desliga
// por salão no dados.json (negocio.permitir_dois_servicos). Default = desligado.
const PERMITIR_DOIS_SERVICOS = negocioJson.permitir_dois_servicos === true;

// Número de contato (wa.me) e imagem Open Graph — usados na rota /link.
const WA_CONTATO = String(negocioJson.whatsapp_contato || negocioJson.telefone || '').replace(/\D/g, '');
const OG_IMAGEM_RAW = negocioJson.og_imagem || '';

// Chat do Telegram do salão/dona: recebe aviso de TODOS os agendamentos
// (independente do profissional). Vazio = ninguém recebe o aviso "geral".
const CHAT_SALAO = negocioJson.telegram_chat_id || process.env.TELEGRAM_CHAT_SALAO || null;

// WhatsApp da dona/salão: recebe os MESMOS avisos do Telegram, também por WhatsApp.
// O número vem do dados.json; a instância de envio é dedicada (WHATSAPP_INSTANCE_AVISOS).
// Ambos vazios = não envia aviso por WhatsApp (o Telegram segue valendo).
const WHATSAPP_AVISO_SALAO = negocioJson.whatsapp_aviso || process.env.WHATSAPP_AVISO_SALAO || null;
const INSTANCIA_AVISOS = process.env.WHATSAPP_INSTANCE_AVISOS || null;

// Aviso à gestão (dona/profissional) em DOIS canais: Telegram (como sempre) e
// WhatsApp da dona (novo). Tudo fire-and-forget — nunca trava o agendamento.
// tipo: 'novo' | 'cancelado' | 'remarcar'.
function avisarGestao({ chatProfissional, chatSalao, tipo, dados }) {
  notificar({ chatProfissional, chatSalao, texto: montarAviso(tipo, dados) });
  if (WHATSAPP_AVISO_SALAO) {
    const texto = htmlParaWhatsapp(montarAviso(tipo, dados));
    enviarWhatsapp(WHATSAPP_AVISO_SALAO, texto, {
      instancia: INSTANCIA_AVISOS || undefined, // vazio => usa a instância de envio do cliente
      semPrefixo: true,
      imediato: true,
    }).catch((e) => console.error('[aviso-wa] falha:', e.message));
  }
}

// Agenda central do salão (Cenário 2): grava uma 2ª cópia do evento aqui, além
// da agenda da profissional. Ausente/vazio = Cenários 1 e 3 (grava só na agenda
// da profissional). NÃO usar no Cenário 3 (a dona já vê tudo) — causaria duplicidade.
const CALENDAR_CENTRAL = negocioJson.calendar_central || process.env.CALENDAR_CENTRAL || null;
if (CALENDAR_CENTRAL) {
  console.log('[boot] Cenário 2 ativo — agenda central:', CALENDAR_CENTRAL);
}

// Lê o index.html uma vez e injeta o tema (cores/fontes) + textos do negócio.
// Injetar no servidor (em vez de no JS do navegador) evita o "flash" de tema errado.
const TEMPLATE = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8');
function paginaInicial() {
  const head =
    `<style>:root{${cssVars(tema)}}</style>` +
    `<link rel="stylesheet" href="${tema.fonteUrl}">` +
    `<script>window.__CFG=${JSON.stringify({ ...tema.rotulos, permitirDoisServicos: PERMITIR_DOIS_SERVICOS })};</script>`;
  return TEMPLATE
    .replace('<!--TEMA-->', head)
    .split('{{NOME}}').join(NEGOCIO.nome)
    .split('{{SUBTITULO}}').join(NEGOCIO.subtitulo)
    .split('{{CIDADE}}').join(NEGOCIO.cidade)
    .split('{{T_STEP_PROF}}').join(PERFIL.stepProfissional)
    .split('{{T_TITULO_PROF}}').join(PERFIL.tituloProfissional)
    .split('{{T_SUB_PROF}}').join(PERFIL.subProfissional)
    .split('{{T_SUB_SERV}}').join(PERFIL.subServico);
}

// A página inicial passa pela rota (p/ tematizar); os demais estáticos (app.js,
// styles.css, fotos) seguem pelo static. index:false para o static não servir o '/'.
app.get('/', (_req, res) => res.type('html').send(paginaInicial()));

// Página de redirecionamento com Open Graph customizado.
// Scrapers (WhatsApp, Telegram, etc.) lêem as tags og:* e exibem o preview do salão.
// Visitantes humanos são redirecionados imediatamente para o WhatsApp de contato.
app.get('/link', (_req, res) => {
  const titulo = [NEGOCIO.nome, NEGOCIO.subtitulo].filter(Boolean).join(' — ');
  const descricao = `Agende seu horário com ${NEGOCIO.nome}`;
  const waUrl = WA_CONTATO ? `https://wa.me/${WA_CONTATO}` : (LANDING_URL || '/');
  const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta property="og:type" content="website">
  <meta property="og:title" content="${titulo}">
  <meta property="og:description" content="${descricao}">
  ${OG_IMAGEM ? `<meta property="og:image" content="${OG_IMAGEM}">` : ''}
  <meta property="og:url" content="${LANDING_URL || waUrl}">
  <title>${titulo}</title>
  <meta http-equiv="refresh" content="0;url=${waUrl}">
</head>
<body>
  <script>window.location.replace(${JSON.stringify(waUrl)});</script>
  <p style="font-family:sans-serif;text-align:center;margin-top:3rem">Redirecionando para o WhatsApp…</p>
  <p style="font-family:sans-serif;text-align:center"><a href="${waUrl}">Clique aqui se não for redirecionado</a></p>
</body>
</html>`;
  res.type('html').send(html);
});

app.use(express.static(path.join(__dirname, 'public'), { index: false }));

// --- Rate limit ---
// Geral: protege toda a API contra abuso de volume.
const limiteGeral = rateLimit({
  windowMs: 60 * 1000, // 1 minuto
  max: 100, // até 100 requisições/min por IP (folgado p/ navegação normal)
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV === 'test',
});
app.use(limiteGeral);

// Específico e mais rígido na criação de agendamento (rota pública sensível).
const limiteAgendamento = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 5, // até 5 agendamentos por IP a cada 15 min
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV === 'test',
  message: { erro: 'Muitas tentativas. Aguarde alguns minutos e tente novamente.' },
});

const TZ = process.env.TIMEZONE || 'America/Sao_Paulo';
// Offset fixo do fuso (Brasil não tem horário de verão desde 2019).
const OFFSET = process.env.TIMEZONE_OFFSET || '-03:00';
const { hh } = require('./utils');

// Janela de atendimento (vinda do .env; padrão 9h–19h se não definida).
//   EXPEDIENTE_INICIO=9  EXPEDIENTE_FIM=19
const EXPEDIENTE = {
  inicioHora: parseInt(process.env.EXPEDIENTE_INICIO || '9', 10),
  fimHora: parseInt(process.env.EXPEDIENTE_FIM || '19', 10),
};
// Passo da grade de horários (minutos). De quanto em quanto tempo um serviço
// pode COMEÇAR (9:00, 9:30, 10:00...). É independente da duração do serviço.
//   SLOT_STEP_MIN=30 (padrão) -> inícios de meia em meia hora
const SLOT_STEP_MIN = parseInt(process.env.SLOT_STEP_MIN || '30', 10);
// Antecedência mínima (minutos) entre AGORA e o início do horário que o cliente
// pode marcar. Evita marcações "em cima da hora".
//   ANTECEDENCIA_AGENDAMENTO_MIN=120 (padrão) -> só aparecem horários a partir de agora + 2h
//   ANTECEDENCIA_AGENDAMENTO_MIN=0            -> desliga a regra (mantém só o filtro de passado)
const ANTECEDENCIA_AGENDAMENTO_MIN = parseInt(process.env.ANTECEDENCIA_AGENDAMENTO_MIN || '120', 10);
// Dias da semana sem atendimento (0=domingo ... 6=sábado), vindos do .env.
//   FOLGAS=0      -> fecha domingo (padrão)
//   FOLGAS=0,6    -> fecha domingo e sábado
//   FOLGAS=       -> (vazio) abre todos os dias (use só em testes)
const FOLGAS = (process.env.FOLGAS ?? '0')
  .split(',')
  .map((s) => parseInt(s.trim(), 10))
  .filter((n) => !Number.isNaN(n));
// Janela máxima de agendamento (dias à frente)
const JANELA_DIAS = parseInt(process.env.JANELA_DIAS || '30', 10);
// Endereço público da landing (para o link de reagendamento). Preencha quando o Tunnel estiver no ar.
// Barra final removida para evitar duplo // ao concatenar caminhos (ex: /link, /fotos).
const LANDING_URL = (process.env.LANDING_URL || 'http://localhost:8090').replace(/\/$/, '');
const OG_IMAGEM = OG_IMAGEM_RAW.startsWith('http')
  ? OG_IMAGEM_RAW
  : OG_IMAGEM_RAW.startsWith('/')
    ? `${LANDING_URL}${OG_IMAGEM_RAW}`
    : '';

// Início do dia de hoje no fuso de SP (independente do fuso do servidor)
function inicioHojeSP() {
  const hojeStr = new Date().toLocaleDateString('en-CA', { timeZone: TZ });
  return new Date(`${hojeStr}T00:00:00${OFFSET}`);
}

// Gera os horários livres de UM dia, dado o serviço (duração), os blocos
// ocupados e o instante atual. Reaproveitada por /horarios-disponiveis e
// /dias-disponiveis (assim a regra de disponibilidade fica num único lugar).
const gerarSlotsDoDia = (dataISO, duracao, ocupados, agora) =>
  _gerarSlots(dataISO, duracao, ocupados, agora, {
    inicioHora: EXPEDIENTE.inicioHora,
    fimHora: EXPEDIENTE.fimHora,
    slotStep: SLOT_STEP_MIN,
    antecedenciaMin: ANTECEDENCIA_AGENDAMENTO_MIN,
    offset: OFFSET,
    tz: TZ,
  });

// ---------- GET /profissionais ----------
app.get('/profissionais', (req, res) => {
  const rows = db.prepare('SELECT id, nome, foto_url FROM profissionais').all();
  res.json(rows);
});

// ---------- GET /servicos ----------
// Com ?profissionalId=, devolve só os serviços daquela profissional (Opção B).
// Sem o parâmetro, devolve todos (compatibilidade / uso administrativo futuro).
app.get('/servicos', (req, res) => {
  const { profissionalId } = req.query;
  const rows = profissionalId
    ? db.prepare('SELECT id, nome, duracao_min, valor FROM servicos WHERE profissional_id = ? ORDER BY id').all(profissionalId)
    : db.prepare('SELECT id, nome, duracao_min, valor FROM servicos ORDER BY id').all();
  res.json(rows);
});

// ---------- GET /horarios-disponiveis ----------
app.get('/horarios-disponiveis', async (req, res) => {
  try {
    const { profissionalId, data, duracaoMin = 40 } = req.query;
    if (!profissionalId || !data) {
      return res.status(400).json({ erro: 'profissionalId e data são obrigatórios' });
    }

    const prof = db.prepare('SELECT * FROM profissionais WHERE id = ?').get(profissionalId);
    if (!prof) return res.status(404).json({ erro: 'Profissional não encontrado' });

    // Bloqueia datas fora da janela permitida (passado ou além de JANELA_DIAS)
    const inicioHoje = inicioHojeSP();
    const limiteJanela = new Date(inicioHoje.getTime() + JANELA_DIAS * 86400000);
    const alvo = new Date(`${data}T00:00:00${OFFSET}`);
    if (alvo < inicioHoje || alvo > limiteJanela) {
      return res.json({ data, horarios: [], motivo: 'Data fora do período disponível.' });
    }

    // Bloqueia dias de folga
    const diaSemana = new Date(`${data}T12:00:00${OFFSET}`).getUTCDay();
    if (FOLGAS.includes(diaSemana)) {
      return res.json({ data, horarios: [], motivo: 'Sem atendimento neste dia.' });
    }

    const calendar = getCalendarClient(prof.subject_email);
    const duracao = parseInt(duracaoMin, 10);

    const inicioDia = new Date(`${data}T00:00:00`);
    const fimDia = new Date(`${data}T23:59:59`);

    const fb = await calendar.freebusy.query({
      requestBody: {
        timeMin: inicioDia.toISOString(),
        timeMax: fimDia.toISOString(),
        timeZone: TZ,
        items: [{ id: prof.calendar_id }],
      },
    });
    const ocupados = fb.data.calendars[prof.calendar_id].busy || [];

    const agora = new Date();
    const slots = gerarSlotsDoDia(data, duracao, ocupados, agora);

    res.json({ data, horarios: slots });
  } catch (err) {
    console.error('[horarios-disponiveis]', err.message);
    res.status(500).json({ erro: 'Falha ao consultar disponibilidade' });
  }
});

// ---------- GET /dias-disponiveis ----------
// Retorna os DIAS do intervalo [inicio, fim] que têm ao menos 1 horário livre
// para o serviço informado — para o calendário "apagar" os dias sem vaga.
// Faz UMA única consulta freeBusy para o período inteiro (não uma por dia) e
// reaproveita a mesma lógica de geração de slots.
// query: ?profissionalId=1&inicio=2026-06-01&fim=2026-06-30&duracaoMin=210
app.get('/dias-disponiveis', async (req, res) => {
  try {
    const { profissionalId, inicio, fim, duracaoMin = 40 } = req.query;
    if (!profissionalId || !inicio || !fim) {
      return res.status(400).json({ erro: 'profissionalId, inicio e fim são obrigatórios' });
    }

    const prof = db.prepare('SELECT * FROM profissionais WHERE id = ?').get(profissionalId);
    if (!prof) return res.status(404).json({ erro: 'Profissional não encontrado' });

    const duracao = parseInt(duracaoMin, 10);
    const agora = new Date();

    // Limita o intervalo pedido à janela permitida [hoje, hoje + JANELA_DIAS]
    const inicioHoje = inicioHojeSP();
    const limiteJanela = new Date(inicioHoje.getTime() + JANELA_DIAS * 86400000);
    let ini = new Date(`${inicio}T00:00:00${OFFSET}`);
    let fimD = new Date(`${fim}T00:00:00${OFFSET}`);
    if (ini < inicioHoje) ini = new Date(inicioHoje);
    if (fimD > limiteJanela) fimD = new Date(limiteJanela);
    if (fimD < ini) return res.json({ disponiveis: [] });

    // Uma só consulta freeBusy cobrindo o período inteiro
    const calendar = getCalendarClient(prof.subject_email);
    const fb = await calendar.freebusy.query({
      requestBody: {
        timeMin: ini.toISOString(),
        timeMax: new Date(fimD.getTime() + 86400000).toISOString(), // +1 dia: cobre o último dia inteiro
        timeZone: TZ,
        items: [{ id: prof.calendar_id }],
      },
    });
    const ocupados = fb.data.calendars[prof.calendar_id].busy || [];

    // Varre dia a dia (Brasil sem horário de verão → passos exatos de 24h),
    // pula folgas e marca os dias com ao menos 1 slot livre.
    const disponiveis = [];
    let d = new Date(ini.getTime());
    while (d <= fimD) {
      const iso = d.toLocaleDateString('en-CA', { timeZone: TZ }); // YYYY-MM-DD em SP
      const diaSemana = new Date(`${iso}T12:00:00${OFFSET}`).getUTCDay();
      if (!FOLGAS.includes(diaSemana)) {
        const slots = gerarSlotsDoDia(iso, duracao, ocupados, agora);
        if (slots.length > 0) disponiveis.push(iso);
      }
      d = new Date(d.getTime() + 86400000);
    }

    res.json({ disponiveis });
  } catch (err) {
    console.error('[dias-disponiveis]', err.message);
    res.status(500).json({ erro: 'Falha ao consultar disponibilidade' });
  }
});

// ---------- POST /agendamento ----------
app.post('/agendamento', limiteAgendamento, async (req, res) => {
  try {
    const {
      profissionalId, servicoNome, valor,
      clienteNome, clienteTelefone, inicio, fim,
    } = req.body;

    if (!profissionalId || !clienteNome || !clienteTelefone || !inicio || !fim) {
      return res.status(400).json({ erro: 'Campos obrigatórios ausentes' });
    }
    if (clienteNome.trim().split(/\s+/).length < 2) {
      return res.status(400).json({ erro: 'Informe nome e ao menos um sobrenome' });
    }
    if (!/^55\d{10,11}$/.test(clienteTelefone)) {
      return res.status(400).json({ erro: 'Telefone inválido' });
    }
    const inicioHoje = inicioHojeSP();
    const limiteJanela = new Date(inicioHoje.getTime() + (JANELA_DIAS + 1) * 86400000);
    const alvoData = new Date(inicio);
    if (alvoData < inicioHoje || alvoData >= limiteJanela) {
      return res.status(400).json({ erro: 'Data fora do período disponível.' });
    }
    // Respeita a antecedência mínima (defesa contra página aberta há muito tempo
    // ou requisição forjada — o filtro de listagem já cuida do fluxo normal).
    const minInicio = new Date(Date.now() + ANTECEDENCIA_AGENDAMENTO_MIN * 60000);
    if (alvoData < minInicio) {
      return res.status(400).json({ erro: 'Esse horário não respeita a antecedência mínima. Escolha outro.' });
    }

    const prof = db.prepare('SELECT * FROM profissionais WHERE id = ?').get(profissionalId);
    if (!prof) return res.status(404).json({ erro: 'Profissional não encontrado' });

    const calendar = getCalendarClient(prof.subject_email);

    const fb = await calendar.freebusy.query({
      requestBody: { timeMin: inicio, timeMax: fim, items: [{ id: prof.calendar_id }] },
    });
    if ((fb.data.calendars[prof.calendar_id].busy || []).length > 0) {
      return res.status(409).json({ erro: 'Esse horário acabou de ser ocupado. Escolha outro.' });
    }

    // Corpo do evento reaproveitado nas duas gravações (profissional + central).
    const corpoEvento = {
      summary: `${servicoNome} - ${clienteNome}`,
      description:
        `Cliente: ${clienteNome}\n` +
        `Telefone: ${clienteTelefone}\n` +
        `Serviço: ${servicoNome}\n` +
        `Valor: R$ ${Number(valor || 0).toFixed(2)}`,
      start: { dateTime: inicio, timeZone: TZ },
      end: { dateTime: fim, timeZone: TZ },
    };

    const evento = await calendar.events.insert({
      calendarId: prof.calendar_id,
      requestBody: corpoEvento,
    });

    // Cenário 2 — gravação dupla na agenda central. Awaited só para capturar o
    // event_id (e poder apagar a cópia no cancelamento), mas um erro aqui SÓ loga:
    // nunca derruba o agendamento já criado na agenda da profissional.
    // Guard `!== prof.calendar_id` evita duplicidade quando central == agenda da prof.
    let eventoCentralId = null;
    if (CALENDAR_CENTRAL && CALENDAR_CENTRAL !== prof.calendar_id) {
      try {
        const evCentral = await calendar.events.insert({
          calendarId: CALENDAR_CENTRAL,
          requestBody: corpoEvento,
        });
        eventoCentralId = evCentral.data.id;
      } catch (e) {
        console.error('[agendamento] falha ao gravar na agenda central (ignorado):', e.message);
      }
    }

    db.prepare(
      `INSERT INTO agendamentos
        (google_event_id, google_event_id_central, profissional_id, servico_nome,
         cliente_nome, cliente_telefone, inicio, fim)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      evento.data.id, eventoCentralId, profissionalId, servicoNome,
      clienteNome, clienteTelefone, inicio, fim
    );

    const dataFmt = new Date(inicio).toLocaleDateString('pt-BR', { timeZone: TZ });
    const horaFmt = new Date(inicio).toLocaleTimeString('pt-BR', {
      hour: '2-digit', minute: '2-digit', timeZone: TZ,
    });
    const primeiroNome = clienteNome.trim().split(/\s+/)[0];

    // Mensagem de confirmação com variação de texto (anti-bot).
    const msgConfirmacao = montarMensagem('confirmacao', {
      nome: primeiroNome,
      servico: servicoNome,
      profissional: prof.nome,
      data: dataFmt,
      hora: horaFmt,
    });

    // IMPORTANTE: fire-and-forget. Não usamos await aqui para o cliente não
    // ficar esperando o delay humano do WhatsApp. A tela de "confirmado"
    // aparece na hora; a mensagem sai em segundo plano.
    enviarWhatsapp(clienteTelefone, msgConfirmacao).catch((e) =>
      console.error('[agendamento] envio whatsapp:', e.message)
    );

    // Aviso ao salão/profissional (Telegram + WhatsApp da dona), fire-and-forget.
    // O profissional recebe os SEUS (Telegram); o salão (se configurado) recebe TODOS.
    avisarGestao({
      chatProfissional: prof.telegram_chat_id,
      chatSalao: CHAT_SALAO,
      tipo: 'novo',
      dados: {
        cliente: clienteNome,
        servico: servicoNome,
        profissional: prof.nome,
        data: dataFmt,
        hora: horaFmt,
        telefone: clienteTelefone,
      },
    });

    res.status(201).json({ ok: true, eventId: evento.data.id });
  } catch (err) {
    console.error('[agendamento]', err.message);
    res.status(500).json({ erro: 'Falha ao criar agendamento' });
  }
});

// ---------- POST /webhook-whatsapp (Evolution API) ----------
// Lê o evento messages.upsert e processa as respostas:
//   1 = Confirmar | 2 = Reagendar | 3 = Cancelar
app.post('/webhook-whatsapp', async (req, res) => {
  // Responde 200 imediatamente para o gateway não reenviar em loop.
  res.sendStatus(200);

  try {
    const body = req.body || {};

    // Filtro de evento TOLERANTE: a Evolution pode mandar 'messages.upsert',
    // 'MESSAGES_UPSERT' ou variações. Normaliza antes de comparar.
    const evento = String(body.event || '').toLowerCase().replace(/_/g, '.');
    console.log('[webhook] recebido. event =', JSON.stringify(body.event), '-> normalizado:', evento);
    if (evento !== 'messages.upsert') {
      console.log('[webhook] ignorado (evento não é messages.upsert)');
      return;
    }

    const data = body.data || {};
    const key = data.key || {};

    // Ignora mensagens enviadas pela própria manicure (evita loop) e grupos.
    if (key.fromMe) {
      console.log('[webhook] ignorado (fromMe = true)');
      return;
    }
    const remoteJid = key.remoteJid || '';
    if (!remoteJid.includes('@s.whatsapp.net')) {
      console.log('[webhook] ignorado (não é conversa 1:1):', remoteJid);
      return;
    }

    // Número no mesmo formato salvo no banco: 55 + DDD + número
    const phone = remoteJid.split('@')[0].split(':')[0];

    // Texto: mensagem simples vem em conversation; texto "longo" em extendedTextMessage.
    const msg = data.message || {};
    const texto = (msg.conversation || msg.extendedTextMessage?.text || '').trim();
    console.log(`[webhook] de ${phone} | texto: "${texto}"`);
    if (!['1', '2', '3'].includes(texto)) {
      console.log('[webhook] ignorado (texto não é 1, 2 ou 3)');
      return;
    }

    // Agendamento ativo mais próximo desse número
    const ag = db
      .prepare(
        `SELECT * FROM agendamentos
         WHERE cliente_telefone = ? AND status = 'confirmado'
         ORDER BY inicio ASC LIMIT 1`
      )
      .get(phone);

    if (!ag) {
      // No modo central a Evolution faz fan-out do mesmo inbound p/ todos os
      // containers; só o dono do telefone tem o agendamento. Os demais ficam em
      // SILÊNCIO — senão cada salão responderia "não encontrei" ao cliente.
      if (modoWhatsapp === 'central') {
        console.log('[webhook] modo central: telefone sem agendamento neste container, ignorando');
        return;
      }
      console.log('[webhook] nenhum agendamento confirmado para', phone);
      await enviarWhatsapp(phone, 'Não encontrei um agendamento ativo no seu número. 🤔');
      return;
    }
    console.log(`[webhook] agendamento encontrado: id ${ag.id}, inicio ${ag.inicio}`);

    const prof = db.prepare('SELECT * FROM profissionais WHERE id = ?').get(ag.profissional_id);
    if (!prof) {
      console.error('[webhook] profissional não encontrado para agendamento', ag.id);
      await enviarWhatsapp(phone, 'Tive um problema ao processar. Por favor, fale com o salão. 🙏');
      return;
    }
    const calendar = getCalendarClient(prof.subject_email);

    // --- Helper: remove o evento do Google e marca como cancelado ---
    // Retorna true só se o cancelamento foi REALMENTE concluído.
    async function liberarAgenda(novoStatus) {
      try {
        if (ag.google_event_id) {
          await calendar.events.delete({
            calendarId: prof.calendar_id,
            eventId: ag.google_event_id,
          });
          console.log('[webhook] evento removido do Google:', ag.google_event_id);
        } else {
          console.warn('[webhook] agendamento sem google_event_id; só atualiza o banco');
        }

        // Cenário 2 — apaga também a cópia da agenda central, se houver. Bloco
        // isolado: uma falha aqui NUNCA impede o cancelamento principal (404/410
        // = evento já não existe, tratado como sucesso silencioso).
        if (CALENDAR_CENTRAL && ag.google_event_id_central) {
          try {
            await calendar.events.delete({
              calendarId: CALENDAR_CENTRAL,
              eventId: ag.google_event_id_central,
            });
            console.log('[webhook] cópia removida da agenda central:', ag.google_event_id_central);
          } catch (e) {
            const code = e?.code || e?.response?.status;
            if (code !== 410 && code !== 404) {
              console.error('[webhook] falha ao apagar cópia da central (ignorado):', e.message);
            }
          }
        }

        db.prepare('UPDATE agendamentos SET status = ? WHERE id = ?').run(novoStatus, ag.id);
        console.log(`[webhook] agendamento ${ag.id} marcado como ${novoStatus}`);
        return true;
      } catch (e) {
        // 410/404 = evento já não existe no Google: tratamos como "já liberado".
        const code = e?.code || e?.response?.status;
        if (code === 410 || code === 404) {
          console.warn('[webhook] evento já não existia no Google; marcando como', novoStatus);
          db.prepare('UPDATE agendamentos SET status = ? WHERE id = ?').run(novoStatus, ag.id);
          return true;
        }
        console.error('[webhook] FALHA ao liberar agenda:', e.message);
        return false;
      }
    }

    // Primeiro nome do cliente, pra personalizar as respostas.
    const primeiroNomeCli = (ag.cliente_nome || '').trim().split(/\s+/)[0] || '';

    // Data/hora do agendamento, para os avisos de Telegram ao salão/profissional.
    const agData = new Date(ag.inicio).toLocaleDateString('pt-BR', { timeZone: TZ });
    const agHora = new Date(ag.inicio).toLocaleTimeString('pt-BR', {
      hour: '2-digit', minute: '2-digit', timeZone: TZ,
    });
    const avisarSalao = (tipo) =>
      avisarGestao({
        chatProfissional: prof.telegram_chat_id,
        chatSalao: CHAT_SALAO,
        tipo,
        dados: {
          cliente: ag.cliente_nome,
          servico: ag.servico_nome,
          profissional: prof.nome,
          data: agData,
          hora: agHora,
        },
      });

    if (texto === '1') {
      // CONFIRMAR
      db.prepare("UPDATE agendamentos SET status = 'confirmado' WHERE id = ?").run(ag.id);
      await enviarWhatsapp(phone, montarMensagem('confirmado', { nome: primeiroNomeCli }));
      console.log('[webhook] confirmado id', ag.id);
    } else if (texto === '2') {
      // REAGENDAR: SÓ avisa "liberado" se realmente liberou.
      const ok = await liberarAgenda('cancelado');
      if (ok) {
        avisarSalao('remarcar');
        await enviarWhatsapp(
          phone,
          montarMensagem('reagendar', { nome: primeiroNomeCli, link: LANDING_URL })
        );
      } else {
        await enviarWhatsapp(
          phone,
          'Tive um problema ao liberar seu horário. Por favor, fale com o salão. 🙏'
        );
      }
    } else if (texto === '3') {
      // CANCELAR
      const ok = await liberarAgenda('cancelado');
      if (ok) avisarSalao('cancelado');
      await enviarWhatsapp(
        phone,
        ok
          ? montarMensagem('cancelado', { nome: primeiroNomeCli })
          : 'Tive um problema ao cancelar. Por favor, fale com o salão. 🙏'
      );
    }
  } catch (err) {
    console.error('[webhook-whatsapp] erro geral:', err.message);
  }
});

if (require.main === module) {
  app.listen(process.env.PORT || 3000, () =>
    console.log(`API + landing rodando em http://localhost:${process.env.PORT || 3000}`)
  );
}

module.exports = app;
