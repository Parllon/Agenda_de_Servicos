// pausar.js — pausa/reativa os containers de um cliente sem apagar nada. Ao
// contrário de deletar.js (down + rmSync), aqui é só stop/start: pasta, banco
// de dados, dados.json e fotos continuam intactos, pronto pra reativar depois.

const { spawn } = require('child_process');
const C = require('./clientes');

const DOCKER_CONFIG = process.env.DOCKER_CONFIG || '/DATA/.docker';

function rodar(cmd, args, cwd) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { cwd, env: { ...process.env, DOCKER_CONFIG } });
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

async function pausar(slug) {
  if (!C.existe(slug)) throw new Error(`cliente '${slug}' não existe`);
  await rodar('docker', ['compose', 'stop'], C.dirCliente(slug));
}

// Religa containers já existentes — mais rápido que "Aplicar" porque não
// recria nada nem roda o seed de novo (o banco já está como estava antes de pausar).
async function reativar(slug) {
  if (!C.existe(slug)) throw new Error(`cliente '${slug}' não existe`);
  await rodar('docker', ['compose', 'start'], C.dirCliente(slug));
}

// true = rodando, false = parado, null = container nem existe ainda (nunca foi aplicado).
async function estaAtivo(slug) {
  try {
    const saida = await rodar('docker', ['inspect', '-f', '{{.State.Running}}', `${slug}-app`]);
    return saida.trim() === 'true';
  } catch (e) {
    return null;
  }
}

module.exports = { pausar, reativar, estaAtivo };
