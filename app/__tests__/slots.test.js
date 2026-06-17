// slots.test.js — testa a função pura gerarSlotsDoDia de utils.js.

const { gerarSlotsDoDia } = require('../utils');

// Configuração padrão que espelha o setup.js (9h–18h, step 30min, sem antecedência).
const CFG = {
  inicioHora: 9,
  fimHora: 18,
  slotStep: 30,
  antecedenciaMin: 0,
  offset: '-03:00',
  tz: 'America/Sao_Paulo',
};

// Data fixa no futuro distante para que nenhum slot seja descartado por "passado".
const DATA = '2099-06-10';

// "Agora" bem antes do expediente: nenhum slot é bloqueado por antecedência.
const AGORA_LIVRE = new Date(`${DATA}T00:00:00-03:00`);

// ─── Slots em dia livre ───────────────────────────────────────────────────────

describe('dia sem ocupação', () => {
  test('serviço de 60min gera 17 slots (9:00 a 17:00, step 30min)', () => {
    // 9:00, 9:30, ..., 17:00 → 17 inícios (17:00+60min=18:00 ≤ limite)
    // 17:30+60min = 18:30 > 18:00 → excluído
    const slots = gerarSlotsDoDia(DATA, 60, [], AGORA_LIVRE, CFG);
    expect(slots).toHaveLength(17);
    expect(slots[0].label).toBe('09:00');
    expect(slots[16].label).toBe('17:00');
  });

  test('serviço de 30min gera mais slots que serviço de 60min', () => {
    const s30 = gerarSlotsDoDia(DATA, 30, [], AGORA_LIVRE, CFG);
    const s60 = gerarSlotsDoDia(DATA, 60, [], AGORA_LIVRE, CFG);
    expect(s30.length).toBeGreaterThan(s60.length);
  });

  test('slot que ultrapassa o fim do expediente não é incluído', () => {
    // Serviço 90min: 17:00+90=18:30 > 18:00 → excluído; 16:30+90=18:00 ≤ 18:00 → incluído
    const slots = gerarSlotsDoDia(DATA, 90, [], AGORA_LIVRE, CFG);
    const labels = slots.map((s) => s.label);
    expect(labels).toContain('16:30');
    expect(labels).not.toContain('17:00');
  });

  test('cada slot tem as propriedades inicio, fim e label', () => {
    const [slot] = gerarSlotsDoDia(DATA, 60, [], AGORA_LIVRE, CFG);
    expect(slot).toHaveProperty('inicio');
    expect(slot).toHaveProperty('fim');
    expect(slot).toHaveProperty('label');
    expect(typeof slot.inicio).toBe('string');
    expect(typeof slot.label).toBe('string');
  });

  test('fim = inicio + duracao minutos', () => {
    const [slot] = gerarSlotsDoDia(DATA, 60, [], AGORA_LIVRE, CFG);
    const diff = (new Date(slot.fim) - new Date(slot.inicio)) / 60000;
    expect(diff).toBe(60);
  });
});

// ─── Bloqueios por ocupação ───────────────────────────────────────────────────

describe('slots com períodos ocupados', () => {
  test('slots que colidem com um evento são removidos', () => {
    // Evento das 11:00 às 12:00
    const ocupados = [
      { start: `${DATA}T11:00:00-03:00`, end: `${DATA}T12:00:00-03:00` },
    ];
    const slots = gerarSlotsDoDia(DATA, 60, ocupados, AGORA_LIVRE, CFG);
    const labels = slots.map((s) => s.label);

    // 10:30→11:30 colide (11:30 > 11:00) → removido
    // 11:00→12:00 colide                   → removido
    // 11:30→12:30 colide (11:30 < 12:00)  → removido
    expect(labels).not.toContain('10:30');
    expect(labels).not.toContain('11:00');
    expect(labels).not.toContain('11:30');

    // 10:00→11:00: fim (11:00) NÃO é > inicio do evento (11:00) → não colide
    // 12:00→13:00: início (12:00) NÃO é < fim do evento (12:00) → não colide
    expect(labels).toContain('10:00');
    expect(labels).toContain('12:00');
  });

  test('dois eventos distintos bloqueiam slots ao redor de cada um', () => {
    const ocupados = [
      { start: `${DATA}T10:00:00-03:00`, end: `${DATA}T10:30:00-03:00` },
      { start: `${DATA}T14:00:00-03:00`, end: `${DATA}T14:30:00-03:00` },
    ];
    const slots = gerarSlotsDoDia(DATA, 30, ocupados, AGORA_LIVRE, CFG);
    const labels = slots.map((s) => s.label);

    expect(labels).not.toContain('10:00');
    expect(labels).not.toContain('14:00');
    expect(labels).toContain('09:00');
    expect(labels).toContain('14:30');
  });
});

// ─── Antecedência mínima ──────────────────────────────────────────────────────

describe('antecedência mínima', () => {
  test('slots antes de agora + antecedência são descartados', () => {
    // agora = 10:00, antecedência = 60min → só slots ≥ 11:00
    const agora = new Date(`${DATA}T10:00:00-03:00`);
    const cfg = { ...CFG, antecedenciaMin: 60 };
    const slots = gerarSlotsDoDia(DATA, 30, [], agora, cfg);
    const labels = slots.map((s) => s.label);

    expect(labels).not.toContain('09:00');
    expect(labels).not.toContain('10:00');
    expect(labels).not.toContain('10:30');
    expect(labels[0]).toBe('11:00');
  });

  test('retorna vazio quando agora já passou do fim do expediente', () => {
    const agora = new Date(`${DATA}T18:00:00-03:00`);
    const slots = gerarSlotsDoDia(DATA, 60, [], agora, CFG);
    expect(slots).toHaveLength(0);
  });

  test('antecedência zero não descarta nenhum slot futuro', () => {
    const agora = new Date(`${DATA}T00:00:00-03:00`);
    const cfg = { ...CFG, antecedenciaMin: 0 };
    const slots = gerarSlotsDoDia(DATA, 60, [], agora, cfg);
    expect(slots[0].label).toBe('09:00');
  });
});
