// aplicar.js — sobe/atualiza um cliente com 1 clique. Mesma sequência do
// atualizar-cliente.sh: docker compose up -d  +  seed.js  +  restart.
//
// Para isto funcionar o container do painel precisa de:
//   - o socket do Docker montado (/var/run/docker.sock)
//   - o docker CLI + plugin compose instalados na imagem (ver Dockerfile)
//   - o projeto montado no MESMO caminho absoluto do host (PROJETO_RAIZ)

const { spawn } = require('child_process');
const C = require('./clientes');

const DOCKER_CONFIG = process.env.DOCKER_CONFIG || '/DATA/.docker';

// Roda um comando capturando stdout+stderr; resolve com o texto, rejeita se sair != 0.
function rodar(cmd, args, cwd) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, {
      cwd,
      env: { ...process.env, DOCKER_CONFIG },
    });
    let saida = '';
    proc.stdout.on('data', (d) => { saida += d; });
    proc.stderr.on('data', (d) => { saida += d; });
    proc.on('error', (e) => reject(new Error(`falha ao executar ${cmd}: ${e.message}`)));
    proc.on('close', (code) => {
      if (code === 0) resolve(saida);
      else reject(new Error(`${[cmd, ...args].join(' ')} saiu com código ${code}\n${saida}`));
    });
  });
}

// Aplica o cliente; devolve o log acumulado dos 3 passos.
async function aplicar(slug) {
  if (!C.existe(slug)) throw new Error(`cliente '${slug}' não existe`);
  const dir = C.dirCliente(slug);

  let log = '';
  log += '-> subindo containers...\n';
  log += await rodar('docker', ['compose', 'up', '-d'], dir);

  log += '\n-> populando o banco a partir do dados.json...\n';
  log += await rodar('docker', ['compose', 'run', '--rm', 'app', 'node', 'seed.js'], dir);

  log += '\n-> reiniciando para recarregar dados/agenda em memória...\n';
  log += await rodar('docker', ['compose', 'restart'], dir);

  log += `\nCliente '${slug}' aplicado com sucesso.\n`;
  return log;
}

module.exports = { aplicar };
