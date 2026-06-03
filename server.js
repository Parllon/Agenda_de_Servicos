// server.js — API REST + serve a landing page (public/)
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const db = require('./db');
const { getCalendarClient } = require('./google');
const { enviarWhatsapp } = require('./whatsapp');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public'))); // serve index.html

const TZ = process.env.TIMEZONE || 'America/Sao_Paulo';
// Offset fixo do fuso (Brasil não tem horário de verão desde 2019).
const OFFSET = process.env.TIMEZONE_OFFSET || '-03:00';
const hh = (h) => String(h).padStart(2, '0');

// Janela de atendimento. Ajuste conforme o expediente da manicure.
const EXPEDIENTE = { inicioHora: 9, fimHora: 19 };
// Dias da semana sem atendimento (0 = domingo ... 6 = sábado)
const FOLGAS = [0]; // fecha aos domingos
// Janela máxima de agendamento (dias à frente)
const JANELA_DIAS = parseInt(process.env.JANELA_DIAS || '30', 10);
// Endereço público da landing (para o link de reagendamento). Preencha quando o Tunnel estiver no ar.
const LANDING_URL = process.env.LANDING_URL || 'http://localhost:8090';

// Início do dia de hoje no fuso de SP (independente do fuso do servidor)
function inicioHojeSP() {
  const hojeStr = new Date().toLocaleDateString('en-CA', { timeZone: TZ });
  return new Date(`${hojeStr}T00:00:00${OFFSET}`);
}

// ---------- GET /profissionais ----------
app.get('/profissionais', (req, res) => {
  const rows = db.prepare('SELECT id, nome FROM profissionais').all();
  res.json(rows);
});

// ---------- GET /servicos ----------
app.get('/servicos', (req, res) => {
  const rows = db
    .prepare('SELECT id, nome, duracao_min, valor FROM servicos')
    .all();
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

    const slots = [];
    const cursor = new Date(`${data}T${hh(EXPEDIENTE.inicioHora)}:00:00${OFFSET}`);
    const limite = new Date(`${data}T${hh(EXPEDIENTE.fimHora)}:00:00${OFFSET}`);
    const agora = new Date();

    while (cursor < limite) {
      const slotInicio = new Date(cursor);
      const slotFim = new Date(cursor.getTime() + duracao * 60000);
      if (slotFim <= limite) {
        const colide = ocupados.some((b) => {
          const bIni = new Date(b.start);
          const bFim = new Date(b.end);
          return slotInicio < bFim && slotFim > bIni;
        });
        const noPassado = slotInicio <= agora;
        if (!colide && !noPassado) {
          slots.push({
            inicio: slotInicio.toISOString(),
            fim: slotFim.toISOString(),
            label: slotInicio.toLocaleTimeString('pt-BR', {
              hour: '2-digit', minute: '2-digit', timeZone: TZ,
            }),
          });
        }
      }
      cursor.setMinutes(cursor.getMinutes() + duracao);
    }

    res.json({ data, horarios: slots });
  } catch (err) {
    console.error('[horarios-disponiveis]', err.message);
    res.status(500).json({ erro: 'Falha ao consultar disponibilidade' });
  }
});

// ---------- POST /agendamento ----------
app.post('/agendamento', async (req, res) => {
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

    const prof = db.prepare('SELECT * FROM profissionais WHERE id = ?').get(profissionalId);
    if (!prof) return res.status(404).json({ erro: 'Profissional não encontrado' });

    const calendar = getCalendarClient(prof.subject_email);

    const fb = await calendar.freebusy.query({
      requestBody: { timeMin: inicio, timeMax: fim, items: [{ id: prof.calendar_id }] },
    });
    if ((fb.data.calendars[prof.calendar_id].busy || []).length > 0) {
      return res.status(409).json({ erro: 'Esse horário acabou de ser ocupado. Escolha outro.' });
    }

    const evento = await calendar.events.insert({
      calendarId: prof.calendar_id,
      requestBody: {
        summary: `${servicoNome} - ${clienteNome}`,
        description:
          `Cliente: ${clienteNome}\n` +
          `Telefone: ${clienteTelefone}\n` +
          `Serviço: ${servicoNome}\n` +
          `Valor: R$ ${Number(valor || 0).toFixed(2)}`,
        start: { dateTime: inicio, timeZone: TZ },
        end: { dateTime: fim, timeZone: TZ },
      },
    });

    db.prepare(
      `INSERT INTO agendamentos
        (google_event_id, profissional_id, servico_nome, cliente_nome,
         cliente_telefone, inicio, fim)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(evento.data.id, profissionalId, servicoNome, clienteNome, clienteTelefone, inicio, fim);

    const dataFmt = new Date(inicio).toLocaleDateString('pt-BR', { timeZone: TZ });
    const horaFmt = new Date(inicio).toLocaleTimeString('pt-BR', {
      hour: '2-digit', minute: '2-digit', timeZone: TZ,
    });
    const primeiroNome = clienteNome.trim().split(/\s+/)[0];

    await enviarWhatsapp(
      clienteTelefone,
      `Olá ${primeiroNome}, seu agendamento para ${servicoNome} foi ` +
        `confirmado para o dia ${dataFmt} às ${horaFmt}. 💅✨`
    );

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
    if (body.event !== 'messages.upsert') return;

    const data = body.data || {};
    const key = data.key || {};

    // Ignora mensagens enviadas pela própria manicure (evita loop) e grupos.
    if (key.fromMe) return;
    const remoteJid = key.remoteJid || '';
    if (!remoteJid.includes('@s.whatsapp.net')) return; // só conversas 1:1

    // Número no mesmo formato salvo no banco: 55 + DDD + número
    const phone = remoteJid.split('@')[0].split(':')[0];

    // Texto: mensagem simples vem em conversation; texto "longo" em extendedTextMessage.
    const msg = data.message || {};
    const texto = (msg.conversation || msg.extendedTextMessage?.text || '').trim();
    if (!['1', '2', '3'].includes(texto)) return; // ignora qualquer outra coisa

    // Agendamento ativo mais próximo desse número
    const ag = db
      .prepare(
        `SELECT * FROM agendamentos
         WHERE cliente_telefone = ? AND status = 'confirmado'
         ORDER BY inicio ASC LIMIT 1`
      )
      .get(phone);

    if (!ag) {
      await enviarWhatsapp(phone, 'Não encontrei um agendamento ativo no seu número. 🤔');
      return;
    }

    const prof = db.prepare('SELECT * FROM profissionais WHERE id = ?').get(ag.profissional_id);
    const calendar = getCalendarClient(prof?.subject_email);

    // --- Helper: remove o evento do Google e marca como cancelado ---
    async function liberarAgenda(novoStatus) {
      await calendar.events
        .delete({ calendarId: prof.calendar_id, eventId: ag.google_event_id })
        .catch((e) => console.error('[webhook] delete evento:', e.message));
      db.prepare('UPDATE agendamentos SET status = ? WHERE id = ?').run(novoStatus, ag.id);
    }

    if (texto === '1') {
      // CONFIRMAR
      await enviarWhatsapp(phone, 'Presença confirmada! Te esperamos. 😊💅');
    } else if (texto === '2') {
      // REAGENDAR: libera o horário atual e manda o link da landing
      await liberarAgenda('cancelado');
      await enviarWhatsapp(
        phone,
        'Sem problemas! Seu horário foi liberado.\n' +
          `Escolha um novo dia e horário aqui: ${LANDING_URL} 💅`
      );
    } else if (texto === '3') {
      // CANCELAR
      await liberarAgenda('cancelado');
      await enviarWhatsapp(phone, 'Seu agendamento foi cancelado. Até a próxima! 💕');
    }
  } catch (err) {
    console.error('[webhook-whatsapp]', err.message);
  }
});

app.listen(process.env.PORT || 3000, () =>
  console.log(`API + landing rodando em http://localhost:${process.env.PORT || 3000}`)
);