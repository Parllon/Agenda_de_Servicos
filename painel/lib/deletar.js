// deletar.js — para os containers de um cliente e remove sua pasta.

const fs = require('fs');
const { spawn } = require('child_process');
const C = require('./clientes');

const DOCKER_CONFIG = process.env.DOCKER_CONFIG || '/DATA/.docker';

function rodar(cmd, args, cwd) {
  return new Promise((resolve) => {
    const proc = spawn(cmd, args, { cwd, env: { ...process.env, DOCKER_CONFIG } });
    let saida = '';
    proc.stdout.on('data', (d) => { saida += d; });
    proc.stderr.on('data', (d) => { saida += d; });
    proc.on('error', () => resolve(saida));
    proc.on('close', () => resolve(saida));
  });
}

async function deletar(slug) {
  if (!C.existe(slug)) throw new Error(`cliente '${slug}' não existe`);
  const dir = C.dirCliente(slug);

  // Para e remove containers (ignora erro: cliente pode nunca ter sido aplicado)
  await rodar('docker', ['compose', 'down', '--remove-orphans'], dir);

  fs.rmSync(dir, { recursive: true, force: true });
}

module.exports = { deletar };
