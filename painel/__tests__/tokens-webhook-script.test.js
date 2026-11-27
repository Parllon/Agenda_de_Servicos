// A saída do script é seguida à risca durante a publicação: recriar um salão com a
// imagem antiga e a senha no .env faz o código antigo recusar todas as respostas.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

test('o script não manda recriar salões antes da imagem nova', () => {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'painel-script-'));
  const dir = path.join(raiz, 'clientes', 'ana');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, '.env'), 'CLIENTE=ana\n');
  fs.writeFileSync(path.join(dir, 'dados.json'), '{}');

  const saida = execFileSync(process.execPath, [path.join(__dirname, '..', 'gerar-tokens-webhook.js')], {
    env: { ...process.env, PROJETO_RAIZ: raiz }, encoding: 'utf8',
  });
  fs.rmSync(raiz, { recursive: true, force: true });

  expect(saida).toContain('receberam senha: ana');
  expect(saida).toContain('Não recrie os salões agora');
  expect(saida).toContain('imagem nova do motor');
  expect(saida).toContain('§8.4');
});
