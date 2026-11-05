// Injeção de linha no .env pelo cadastro público (/api/pedidos).
// O nome do negócio vai para WHATSAPP_PREFIXO_LABEL no .env do cliente; um "\n"
// no nome criaria uma variável nova ("\nCLIENTE=bya").

const os = require('os');
const path = require('path');
process.env.PROJETO_RAIZ = path.join(os.tmpdir(), 'painel-teste-seguranca');

const { validarPedido, ErroPedido } = require('../lib/pedido');
const { updateEnv, parseEnv } = require('../lib/env');

function pedidoValido() {
  return {
    versao: 2,
    protocolo: 'SLT-ABC123',
    consentimentos: { termo_teste: true, lgpd: true },
    contato: { nome: 'Maria', whatsapp: '5521999998888', email_google: 'maria@gmail.com' },
    negocio: { nome: 'Studio Maria', cidade: 'Rio de Janeiro' },
    servicos: [{ nome: 'Corte', duracao_min: 30, valor: 50 }],
    profissionais: [{ nome: 'Maria', servicos: ['Corte'] }],
    horarios: {
      semana: [0, 1, 2, 3, 4, 5, 6].map((dia) => ({ dia, aberto: dia !== 0, abre: '09:00', fecha: '18:00' })),
    },
    visual: { tema: 'auto' },
  };
}

describe('validarPedido — caracteres de controle', () => {
  test('pedido válido passa (controle do teste)', () => {
    expect(validarPedido(pedidoValido())).toBe(true);
  });

  test('nome do negócio com quebra de linha é recusado', () => {
    const p = pedidoValido();
    p.negocio.nome = 'Studio\nCLIENTE=bya';
    expect(() => validarPedido(p)).toThrow(ErroPedido);
    expect(() => validarPedido(p)).toThrow(/Caracteres inválidos em: nome do negócio/);
  });

  test.each([
    ['\r', 'Studio\rCLIENTE=bya'],
    ['\t', 'Studio\tMaria'],
    ['U+0000', 'Studio\u0000Maria'],
    ['U+001F', 'Studio\u001FMaria'],
    ['U+007F', 'Studio\u007FMaria'],
  ])('nome do negócio com %s é recusado', (_, nome) => {
    const p = pedidoValido();
    p.negocio.nome = nome;
    expect(() => validarPedido(p)).toThrow(ErroPedido);
  });

  test('vale para os outros campos (ex.: nome do profissional)', () => {
    const p = pedidoValido();
    p.profissionais[0].nome = 'Maria\nX=1';
    expect(() => validarPedido(p)).toThrow(ErroPedido);
  });

  test('observações aceitam quebra de linha, mas não outros controles', () => {
    const p = pedidoValido();
    p.observacoes = 'linha 1\nlinha 2';
    expect(validarPedido(p)).toBe(true);
    p.observacoes = 'linha 1\r\nlinha 2';
    expect(() => validarPedido(p)).toThrow(ErroPedido);
  });
});

describe('updateEnv — segunda proteção', () => {
  test('\\r e \\n no valor não criam linha nova', () => {
    const original = 'CLIENTE=studio\nWHATSAPP_PREFIXO_LABEL=antigo\n';
    const novo = updateEnv(original, { WHATSAPP_PREFIXO_LABEL: 'Studio\r\nCLIENTE=bya' });
    const env = parseEnv(novo);
    expect(env.CLIENTE).toBe('studio');
    expect(env.WHATSAPP_PREFIXO_LABEL).toBe('Studio CLIENTE=bya');
    expect(novo.split('\n').filter((l) => l.startsWith('CLIENTE='))).toHaveLength(1);
  });

  test('chave nova (acrescentada no fim) também é limpa', () => {
    const novo = updateEnv('A=1', { B: 'x\nCLIENTE=bya' });
    expect(parseEnv(novo)).toEqual({ A: '1', B: 'x CLIENTE=bya' });
  });
});
