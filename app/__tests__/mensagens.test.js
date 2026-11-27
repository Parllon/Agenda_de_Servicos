// mensagens.test.js — testa a lógica de montagem e formato das mensagens automáticas.

const { montarMensagem, PADRAO } = require('../mensagens');

const TODOS_OS_TIPOS = ['confirmacao', 'vespera', 'lembrete1h', 'reagendar', 'confirmado', 'cancelado'];

const DADOS = {
  nome: 'Ana',
  servico: 'Manicure',
  profissional: 'Julia',
  data: '18/06/2026',
  hora: '10:00',
  link: 'https://test.example.com',
};

// ─── Estrutura do PADRAO ─────────────────────────────────────────────────────

describe('PADRAO — estrutura', () => {
  test.each(TODOS_OS_TIPOS)('tipo "%s" existe e tem exatamente 10 variações', (tipo) => {
    expect(Array.isArray(PADRAO[tipo])).toBe(true);
    expect(PADRAO[tipo]).toHaveLength(10);
  });

  test.each(TODOS_OS_TIPOS)('todas as variações de "%s" são strings não vazias', (tipo) => {
    for (const variacao of PADRAO[tipo]) {
      expect(typeof variacao).toBe('string');
      expect(variacao.length).toBeGreaterThan(0);
    }
  });
});

// ─── Substituição de variáveis ────────────────────────────────────────────────

describe('montarMensagem — substituição de variáveis', () => {
  test('substitui {nome} na confirmacao', () => {
    const msg = montarMensagem('confirmacao', DADOS);
    expect(msg).toContain('Ana');
  });

  test('substitui {servico} na confirmacao', () => {
    const msg = montarMensagem('confirmacao', DADOS);
    expect(msg).toContain('Manicure');
  });

  test('substitui {profissional} na confirmacao', () => {
    const msg = montarMensagem('confirmacao', DADOS);
    expect(msg).toContain('Julia');
  });

  test('substitui {data} e {hora} na confirmacao', () => {
    const msg = montarMensagem('confirmacao', DADOS);
    expect(msg).toContain('18/06/2026');
    expect(msg).toContain('10:00');
  });

  test('substitui {link} em reagendar', () => {
    const msg = montarMensagem('reagendar', DADOS);
    expect(msg).toContain('https://test.example.com');
  });

  test.each(TODOS_OS_TIPOS)('tipo "%s" não deixa tokens {…} sem preencher', (tipo) => {
    const msg = montarMensagem(tipo, DADOS);
    expect(msg).not.toMatch(/\{[a-z]+\}/);
  });

  test('lança erro para tipo desconhecido', () => {
    expect(() => montarMensagem('tipo_invalido', {})).toThrow('tipo_invalido');
  });
});

// ─── Conteúdo obrigatório ─────────────────────────────────────────────────────
// montarMensagem sorteia uma variação; por isso estes testes percorrem TODAS as
// do PADRAO, senão uma variação quebrada passaria na maioria das execuções.

describe('PADRAO — conteúdo obrigatório em todas as variações', () => {
  test.each([
    ['confirmacao', ['{servico}', '{profissional}', '{data}', '{hora}']],
    ['vespera', ['{servico}', '{hora}']],
    ['lembrete1h', ['{servico}']],
    ['reagendar', ['👉 {link}']],
  ])('%s informa %j', (tipo, trechos) => {
    for (const variacao of PADRAO[tipo]) {
      for (const trecho of trechos) expect(variacao).toContain(trecho);
    }
  });

  // As opções oferecidas precisam bater com o que o webhook entende (1/2/3).
  test.each([
    ['confirmacao', ['2️⃣ Reagendar', '3️⃣ Cancelar']],
    ['vespera', ['1️⃣ Confirmar', '2️⃣ Reagendar', '3️⃣ Cancelar']],
    ['lembrete1h', []],
    ['reagendar', []],
    ['confirmado', []],
    ['cancelado', []],
  ])('%s oferece exatamente as opções %j', (tipo, opcoes) => {
    for (const variacao of PADRAO[tipo]) {
      expect(variacao.match(/[123]️⃣ \S+/g) || []).toEqual(opcoes);
    }
  });
});

// ─── Rodapé de contato ────────────────────────────────────────────────────────

describe('rodapeContato — modo proprio (padrão do setup)', () => {
  test('não anexa rodapé no modo proprio', () => {
    // setup.js define WHATSAPP_MODE=proprio → rodapeContato() retorna ''
    const msg = montarMensagem('confirmacao', DADOS);
    expect(msg).not.toContain('Qualquer dúvida');
  });

  test('vespera também não anexa rodapé no modo proprio', () => {
    const msg = montarMensagem('vespera', DADOS);
    expect(msg).not.toContain('Qualquer dúvida');
  });
});
