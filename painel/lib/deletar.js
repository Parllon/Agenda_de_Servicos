// deletar.js — para os containers de um cliente e remove sua pasta.

const fs = require('fs');
const path = require('path');
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

  // Loga (não apaga) agendas Google que ficam órfãs — limpeza manual se precisar.
  try {
    const dados = JSON.parse(fs.readFileSync(path.join(dir, 'dados.json'), 'utf8'));
    const ids = (dados.profissionais || [])
      .filter((p) => p.calendar_id)
      .map((p) => `  - ${p.nome}: ${p.calendar_id}`);
    if (dados.negocio?.calendar_central) ids.push(`  - (central): ${dados.negocio.calendar_central}`);
    if (ids.length) {
      console.warn(`[deletar:${slug}] agendas Google não apagadas (cliente excluído):\n${ids.join('\n')}`);
    }
  } catch (e) { /* dados.json ausente/corrompido não bloqueia a exclusão */ }

  fs.rmSync(dir, { recursive: true, force: true });
}

module.exports = { deletar };
