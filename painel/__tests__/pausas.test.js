// Almoço como evento recorrente na agenda Google de cada profissional (lib/pausas.js)
// + como ele chega do cadastro do site (lib/pedido.js).

const os = require('os');
const path = require('path');
process.env.PROJETO_RAIZ = path.join(os.tmpdir(), 'painel-teste-pausas');

const { sincronizarCliente, corpoEvento, diasRrule } = require('../lib/pausas');
const { validarPedido, paraConfig, ErroPedido } = require('../lib/pedido');

// Agenda falsa: guarda os eventos por agenda e registra as chamadas.
function agendaFalsa() {
  let seq = 0;
  const eventos = new Map(); // `${calendarId}|${id}` -> corpo
  const chamadas = [];
  const erro404 = () => Object.assign(new Error('Not Found'), { code: 404 });
  const calendar = {
    events: {
      insert: jest.fn(async ({ calendarId, requestBody }) => {
        const id = `ev${++seq}`;
        eventos.set(`${calendarId}|${id}`, requestBody);
        chamadas.push(['insert', calendarId, id]);
        return { data: { id } };
      }),
      patch: jest.fn(async ({ calendarId, eventId, requestBody }) => {
        if (!eventos.has(`${calendarId}|${eventId}`)) throw erro404();
        eventos.set(`${calendarId}|${eventId}`, requestBody);
        chamadas.push(['patch', calendarId, eventId]);
        return { data: { id: eventId } };
      }),
      delete: jest.fn(async ({ calendarId, eventId }) => {
        if (!eventos.delete(`${calendarId}|${eventId}`)) throw erro404();
        chamadas.push(['delete', calendarId, eventId]);
        return {};
      }),
    },
  };
  return { calendar, eventos, chamadas };
}

const prof = (nome, calendar_id, pausa) => ({ nome, calendar_id, servicos: [{ nome: 'Corte' }], ...(pausa ? { pausa } : {}) });
const ficha = (...profs) => ({ negocio: { nome: 'Teste' }, profissionais: profs });
const clone = (x) => JSON.parse(JSON.stringify(x));
const HOJE = '2026-11-06';

describe('evento', () => {
  test('dias da recorrência = dias abertos (complemento de FOLGAS)', () => {
    expect(diasRrule('0')).toBe('MO,TU,WE,TH,FR,SA');
    expect(diasRrule('0,6')).toBe('MO,TU,WE,TH,FR');
    expect(diasRrule(undefined)).toBe('MO,TU,WE,TH,FR,SA'); // padrão do motor: fecha domingo
    expect(diasRrule('0,1,2,3,4,5,6')).toBe('');
  });

  test('corpo: recorrente, opaco, sem lembrete, horário de São Paulo, marcado', () => {
    const c = corpoEvento({ inicio: '12:00', fim: '13:30' }, '0,1', HOJE);
    expect(c.summary).toBe('Almoço');
    expect(c.start).toEqual({ dateTime: '2026-11-06T12:00:00', timeZone: 'America/Sao_Paulo' });
    expect(c.end).toEqual({ dateTime: '2026-11-06T13:30:00', timeZone: 'America/Sao_Paulo' });
    expect(c.recurrence).toEqual(['RRULE:FREQ=WEEKLY;BYDAY=TU,WE,TH,FR,SA']);
    expect(c.transparency).toBe('opaque');
    expect(c.reminders).toEqual({ useDefault: false, overrides: [] });
    expect(c.extendedProperties.private.slotme).toBe('pausa');
  });
});

describe('sincronizarCliente', () => {
  test('cria um evento só na agenda de quem tem almoço', async () => {
    const g = agendaFalsa();
    const depois = ficha(prof('Ana', 'cal-ana', { inicio: '12:00', fim: '13:00' }), prof('Bia', 'cal-bia'));
    const r = await sincronizarCliente(null, depois, { depois: '0' }, { calendar: g.calendar, hoje: HOJE });
    expect(r.criados).toEqual(['Ana']);
    expect(g.chamadas).toEqual([['insert', 'cal-ana', 'ev1']]);
    expect(depois.profissionais[0].pausa.evento_id).toBe('ev1');
    expect(depois.profissionais[1].pausa).toBeUndefined();
  });

  test('nada mudou → não chama o Google', async () => {
    const g = agendaFalsa();
    const antes = ficha(prof('Ana', 'cal-ana', { inicio: '12:00', fim: '13:00' }));
    await sincronizarCliente(null, antes, { depois: '0' }, { calendar: g.calendar, hoje: HOJE });
    g.chamadas.length = 0;
    const r = await sincronizarCliente(antes, clone(antes), { antes: '0', depois: '0' }, { calendar: g.calendar, hoje: HOJE });
    expect(g.chamadas).toEqual([]);
    expect(r).toEqual({ criados: [], alterados: [], removidos: [], avisos: [] });
  });

  test('ficha sem almoço nenhum nem abre o cliente do Google', async () => {
    const r = await sincronizarCliente(null, ficha(prof('Ana', 'cal-ana')), { depois: '0' }, { calendar: null });
    expect(r.criados).toEqual([]);
  });

  test('mudou o horário → atualiza o MESMO evento', async () => {
    const g = agendaFalsa();
    const antes = ficha(prof('Ana', 'cal-ana', { inicio: '12:00', fim: '13:00' }));
    await sincronizarCliente(null, antes, { depois: '0' }, { calendar: g.calendar, hoje: HOJE });
    const depois = clone(antes);
    depois.profissionais[0].pausa = { ...depois.profissionais[0].pausa, inicio: '12:30', fim: '13:30' };
    g.chamadas.length = 0;
    const r = await sincronizarCliente(antes, depois, { antes: '0', depois: '0' }, { calendar: g.calendar, hoje: HOJE });
    expect(r.alterados).toEqual(['Ana']);
    expect(g.chamadas).toEqual([['patch', 'cal-ana', 'ev1']]);
    expect(g.eventos.get('cal-ana|ev1').start.dateTime).toBe('2026-11-06T12:30:00');
  });

  test('mudaram as folgas → atualiza a recorrência', async () => {
    const g = agendaFalsa();
    const antes = ficha(prof('Ana', 'cal-ana', { inicio: '12:00', fim: '13:00' }));
    await sincronizarCliente(null, antes, { depois: '0' }, { calendar: g.calendar, hoje: HOJE });
    const r = await sincronizarCliente(antes, clone(antes), { antes: '0', depois: '0,6' }, { calendar: g.calendar, hoje: HOJE });
    expect(r.alterados).toEqual(['Ana']);
    expect(g.eventos.get('cal-ana|ev1').recurrence).toEqual(['RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR']);
  });

  test('dono apagou a série na agenda → cria de novo', async () => {
    const g = agendaFalsa();
    const antes = ficha(prof('Ana', 'cal-ana', { inicio: '12:00', fim: '13:00' }));
    await sincronizarCliente(null, antes, { depois: '0' }, { calendar: g.calendar, hoje: HOJE });
    g.eventos.clear(); // apagado direto no Google
    const depois = clone(antes);
    depois.profissionais[0].pausa.fim = '14:00';
    const r = await sincronizarCliente(antes, depois, { antes: '0', depois: '0' }, { calendar: g.calendar, hoje: HOJE });
    expect(r.criados).toEqual(['Ana']);
    expect(depois.profissionais[0].pausa.evento_id).toBe('ev2');
  });

  test('tirou o almoço → apaga o evento', async () => {
    const g = agendaFalsa();
    const antes = ficha(prof('Ana', 'cal-ana', { inicio: '12:00', fim: '13:00' }));
    await sincronizarCliente(null, antes, { depois: '0' }, { calendar: g.calendar, hoje: HOJE });
    const depois = ficha(prof('Ana', 'cal-ana')); // a tela manda sem `pausa`
    const r = await sincronizarCliente(antes, depois, { antes: '0', depois: '0' }, { calendar: g.calendar, hoje: HOJE });
    expect(r.removidos).toEqual(['ev1']);
    expect(g.eventos.size).toBe(0);
  });

  test('removeu o profissional → apaga o evento dele, não mexe no dos outros', async () => {
    const g = agendaFalsa();
    const antes = ficha(
      prof('Ana', 'cal-ana', { inicio: '12:00', fim: '13:00' }),
      prof('Bia', 'cal-bia', { inicio: '13:00', fim: '14:00' }),
    );
    await sincronizarCliente(null, antes, { depois: '0' }, { calendar: g.calendar, hoje: HOJE });
    const depois = ficha(clone(antes.profissionais[1]));
    g.chamadas.length = 0;
    await sincronizarCliente(antes, depois, { antes: '0', depois: '0' }, { calendar: g.calendar, hoje: HOJE });
    expect(g.chamadas).toEqual([['delete', 'cal-ana', 'ev1']]);
    expect([...g.eventos.keys()]).toEqual(['cal-bia|ev2']);
  });

  test('trocou de agenda → apaga da velha e cria na nova', async () => {
    const g = agendaFalsa();
    const antes = ficha(prof('Ana', 'cal-velha', { inicio: '12:00', fim: '13:00' }));
    await sincronizarCliente(null, antes, { depois: '0' }, { calendar: g.calendar, hoje: HOJE });
    const depois = clone(antes);
    depois.profissionais[0].calendar_id = 'cal-nova';
    await sincronizarCliente(antes, depois, { antes: '0', depois: '0' }, { calendar: g.calendar, hoje: HOJE });
    expect([...g.eventos.keys()]).toEqual(['cal-nova|ev2']);
    expect(depois.profissionais[0].pausa.evento_id).toBe('ev2');
  });

  test('profissional sem agenda → aviso, sem chamar o Google', async () => {
    const g = agendaFalsa();
    const depois = ficha(prof('Ana', '', { inicio: '12:00', fim: '13:00' }));
    const r = await sincronizarCliente(null, depois, { depois: '0' }, { calendar: g.calendar, hoje: HOJE });
    expect(r.avisos[0]).toMatch(/Ana: sem agenda Google/);
    expect(g.chamadas).toEqual([]);
  });

  test('erro do Google num profissional vira aviso e não para os outros', async () => {
    const g = agendaFalsa();
    g.calendar.events.insert.mockImplementationOnce(async () => { throw Object.assign(new Error('boom'), { code: 500 }); });
    const depois = ficha(
      prof('Ana', 'cal-ana', { inicio: '12:00', fim: '13:00' }),
      prof('Bia', 'cal-bia', { inicio: '12:00', fim: '13:00' }),
    );
    const r = await sincronizarCliente(null, depois, { depois: '0' }, { calendar: g.calendar, hoje: HOJE });
    expect(r.avisos[0]).toMatch(/Ana: não consegui/);
    expect(r.criados).toEqual(['Bia']);
  });
});

describe('cadastro do site (pedido.js)', () => {
  function pedido(horarios = {}, profs) {
    return {
      versao: 2,
      protocolo: 'SLT-ABC123',
      consentimentos: { termo_teste: true, lgpd: true },
      contato: { nome: 'Maria', whatsapp: '5521999998888', email_google: 'maria@gmail.com' },
      negocio: { nome: 'Studio Maria', cidade: 'Rio de Janeiro' },
      servicos: [{ nome: 'Corte', duracao_min: 30, valor: 50 }],
      profissionais: profs || [
        { nome: 'Ana', servicos: ['Corte'] },
        { nome: 'Bia', servicos: ['Corte'] },
      ],
      horarios: {
        semana: [0, 1, 2, 3, 4, 5, 6].map((dia) => ({ dia, aberto: dia !== 0, abre: '09:00', fecha: '18:00' })),
        pausa: null,
        pausa_por_profissional: false,
        ...horarios,
      },
      visual: { tema: 'auto' },
    };
  }

  test('almoço igual para todos vai para cada profissional', () => {
    const p = pedido({ pausa: { inicio: '12:00', fim: '13:00' } });
    expect(validarPedido(p)).toBe(true);
    const { dados } = paraConfig(p, { slug: 'studiomaria' });
    expect(dados.profissionais.map((x) => x.pausa)).toEqual([
      { inicio: '12:00', fim: '13:00' }, { inicio: '12:00', fim: '13:00' },
    ]);
  });

  test('almoço individual: só quem tem ganha pausa (a geral é ignorada)', () => {
    const p = pedido(
      { pausa_por_profissional: true, pausa: { inicio: '11:00', fim: '12:00' } },
      [
        { nome: 'Ana', servicos: ['Corte'], pausa: { inicio: '12:00', fim: '13:00' } },
        { nome: 'Bia', servicos: ['Corte'], pausa: null },
      ],
    );
    expect(validarPedido(p)).toBe(true);
    const { dados } = paraConfig(p, { slug: 'studiomaria' });
    expect(dados.profissionais[0].pausa).toEqual({ inicio: '12:00', fim: '13:00' });
    expect(dados.profissionais[1].pausa).toBeUndefined();
  });

  test.each([
    ['formato errado', { inicio: '12h', fim: '13:00' }],
    ['fim antes do início', { inicio: '13:00', fim: '12:00' }],
    ['fora do horário de funcionamento', { inicio: '18:30', fim: '19:30' }],
  ])('almoço inválido (%s) é recusado', (_, pausa) => {
    expect(() => validarPedido(pedido({ pausa }))).toThrow(ErroPedido);
  });
});
