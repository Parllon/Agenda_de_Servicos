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
// Garante que o expediente seja calculado no fuso correto mesmo se o
// servidor rodar em UTC (containers/cloud).
const OFFSET = process.env.TIMEZONE_OFFSET || '-03:00';
const hh = (h) => String(h).padStart(2, '0');

// Janela de atendimento. Ajuste conforme o expediente da manicure.
const EXPEDIENTE = { inicioHora: 9, fimHora: 19 };
// Dias da semana sem atendimento (0 = domingo, 1 = segunda ... 6 = sábado)
const FOLGAS = [0]; // fecha aos domingos
// Janela máxima de agendamento (dias à frente)
const JANELA_DIAS = parseInt(process.env.JANELA_DIAS || '30', 10);

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
// query: ?profissionalId=1&data=2025-06-15&duracaoMin=60
app.get('/horarios-disponiveis', async (req, res) => {
  try {
    const { profissionalId, data, duracaoMin = 40 } = req.query;
    if (!profissionalId || !data) {
      return res
        .status(400)
        .json({ erro: 'profissionalId e data são obrigatórios' });
    }

    const prof = db
      .prepare('SELECT * FROM profissionais WHERE id = ?')
      .get(profissionalId);
    if (!prof) return res.status(404).json({ erro: 'Profissional não encontrado' });

    // Bloqueia datas fora da janela permitida (passado ou além de JANELA_DIAS)
    const inicioHoje = inicioHojeSP();
    const limiteJanela = new Date(inicioHoje.getTime() + JANELA_DIAS * 86400000);
    const alvo = new Date(`${data}T00:00:00${OFFSET}`);
    if (alvo < inicioHoje || alvo > limiteJanela) {
      return res.json({ data, horarios: [], motivo: 'Data fora do período disponível.' });
    }

    // Bloqueia dias de folga (dia da semana no fuso correto)
    const diaSemana = new Date(`${data}T12:00:00${OFFSET}`).getUTCDay();
    if (FOLGAS.includes(diaSemana)) {
      return res.json({ data, horarios: [], motivo: 'Sem atendimento neste dia.' });
    }

    const calendar = getCalendarClient(prof.subject_email);
    const duracao = parseInt(duracaoMin, 10);

    const inicioDia = new Date(`${data}T00:00:00`);
    const fimDia = new Date(`${data}T23:59:59`);

    // 1) freeBusy: blocos OCUPADOS na agenda Google
    const fb = await calendar.freebusy.query({
      requestBody: {
        timeMin: inicioDia.toISOString(),
        timeMax: fimDia.toISOString(),
        timeZone: TZ,
        items: [{ id: prof.calendar_id }],
      },
    });
    const ocupados = fb.data.calendars[prof.calendar_id].busy || [];

    // 2) Gera slots dentro do expediente e remove os que colidem / no passado.
    //    Boundaries construídos com offset explícito → corretos em qualquer fuso de servidor.
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
          return slotInicio < bFim && slotFim > bIni; // sobreposição
        });
        const noPassado = slotInicio <= agora;

        if (!colide && !noPassado) {
          slots.push({
            inicio: slotInicio.toISOString(),
            fim: slotFim.toISOString(),
            label: slotInicio.toLocaleTimeString('pt-BR', {
              hour: '2-digit',
              minute: '2-digit',
              timeZone: TZ,
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
      profissionalId,
      servicoNome,
      valor,
      clienteNome,
      clienteTelefone, // E.164: 5521999998888
      inicio,
      fim,
    } = req.body;

    // Validação de servidor (nunca confie só no front)
    if (!profissionalId || !clienteNome || !clienteTelefone || !inicio || !fim) {
      return res.status(400).json({ erro: 'Campos obrigatórios ausentes' });
    }
    if (clienteNome.trim().split(/\s+/).length < 2) {
      return res.status(400).json({ erro: 'Informe nome e ao menos um sobrenome' });
    }
    if (!/^55\d{10,11}$/.test(clienteTelefone)) {
      return res.status(400).json({ erro: 'Telefone inválido' });
    }
    // Bloqueia datas fora da janela permitida
    const inicioHoje = inicioHojeSP();
    const limiteJanela = new Date(inicioHoje.getTime() + (JANELA_DIAS + 1) * 86400000);
    const alvoData = new Date(inicio);
    if (alvoData < inicioHoje || alvoData >= limiteJanela) {
      return res.status(400).json({ erro: 'Data fora do período disponível.' });
    }

    const prof = db
      .prepare('SELECT * FROM profissionais WHERE id = ?')
      .get(profissionalId);
    if (!prof) return res.status(404).json({ erro: 'Profissional não encontrado' });

    const calendar = getCalendarClient(prof.subject_email);

    // Re-checagem anti-corrida: o slot ainda está livre?
    const fb = await calendar.freebusy.query({
      requestBody: {
        timeMin: inicio,
        timeMax: fim,
        items: [{ id: prof.calendar_id }],
      },
    });
    if ((fb.data.calendars[prof.calendar_id].busy || []).length > 0) {
      return res
        .status(409)
        .json({ erro: 'Esse horário acabou de ser ocupado. Escolha outro.' });
    }

    // Insere evento no Google Calendar
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

    // Persiste (necessário para o cron de lembretes)
    db.prepare(
      `INSERT INTO agendamentos
        (google_event_id, profissional_id, servico_nome, cliente_nome,
         cliente_telefone, inicio, fim)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(
      evento.data.id,
      profissionalId,
      servicoNome,
      clienteNome,
      clienteTelefone,
      inicio,
      fim
    );

    // Ação 1: confirmação imediata via WhatsApp
    const dataFmt = new Date(inicio).toLocaleDateString('pt-BR', { timeZone: TZ });
    const horaFmt = new Date(inicio).toLocaleTimeString('pt-BR', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: TZ,
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

// ---------- POST /webhook-whatsapp ----------
// Configure este endpoint no painel do seu gateway para receber respostas (1/2).
app.post('/webhook-whatsapp', async (req, res) => {
  try {
    const { phone, message } = req.body; // ajuste ao formato do seu provedor
    const texto = (message || '').trim();

    const ag = db
      .prepare(
        `SELECT * FROM agendamentos
         WHERE cliente_telefone = ? AND status = 'confirmado'
         ORDER BY inicio ASC LIMIT 1`
      )
      .get(phone);

    if (ag) {
      if (texto === '2') {
        const prof = db
          .prepare('SELECT * FROM profissionais WHERE id = ?')
          .get(ag.profissional_id);
        const calendar = getCalendarClient(prof.subject_email);
        await calendar.events
          .delete({ calendarId: prof.calendar_id, eventId: ag.google_event_id })
          .catch((e) => console.error('delete evento:', e.message));
        db.prepare("UPDATE agendamentos SET status='cancelado' WHERE id=?").run(ag.id);
        await enviarWhatsapp(phone, 'Seu agendamento foi cancelado. Até a próxima! 💕');
      } else if (texto === '1') {
        await enviarWhatsapp(phone, 'Presença confirmada! Te esperamos. 😊');
      }
    }
    res.sendStatus(200);
  } catch (err) {
    console.error('[webhook-whatsapp]', err.message);
    res.sendStatus(200); // sempre 200 p/ o gateway não reenviar em loop
  }
});

app.listen(process.env.PORT || 3000, () =>
  console.log(`API + landing rodando em http://localhost:${process.env.PORT || 3000}`)
);
