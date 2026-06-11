// seed.js — popula o banco a partir da FICHA DO CLIENTE (dados.json), não do código.
// O caminho do JSON vem do ambiente: CAMINHO_DADOS_JSON=/cliente/dados.json
// Rodar: docker compose run --rm app node seed.js
//
// Arquitetura: o MESMO código (imagem motor-agendamento) atende todos os clientes.
// O que muda por cliente é o dados.json (montado pelo compose) — nada de editar código.
require('dotenv').config();
const fs = require('fs');
const db = require('./db');

const caminho = process.env.CAMINHO_DADOS_JSON;
if (!caminho) {
  console.error('ERRO: CAMINHO_DADOS_JSON não definido no .env.');
  process.exit(1);
}
if (!fs.existsSync(caminho)) {
  console.error(`ERRO: arquivo de dados não encontrado: ${caminho}`);
  console.error('Confira o volume do dados.json no docker-compose.yml.');
  process.exit(1);
}

let dados;
try {
  dados = JSON.parse(fs.readFileSync(caminho, 'utf8'));
} catch (e) {
  console.error(`ERRO: dados.json inválido (${caminho}): ${e.message}`);
  process.exit(1);
}

const profissionais = Array.isArray(dados.profissionais) ? dados.profissionais : [];
if (!profissionais.length) {
  console.error('ERRO: dados.json não tem "profissionais" (ou está vazio).');
  process.exit(1);
}

// Limpa e repovoa (idempotente).
db.exec('DELETE FROM profissionais; DELETE FROM servicos;');

const insProf = db.prepare(
  'INSERT INTO profissionais (id, nome, calendar_id, subject_email, foto_url) VALUES (?, ?, ?, ?, ?)'
);
const insServ = db.prepare(
  'INSERT INTO servicos (nome, duracao_min, valor, profissional_id) VALUES (?, ?, ?, ?)'
);

let totalServ = 0;
profissionais.forEach((p, i) => {
  const id = p.id || i + 1;
  insProf.run(id, p.nome, p.calendar_id, p.subject_email || null, p.foto_url || null);
  (p.servicos || []).forEach((s) => {
    insServ.run(s.nome, s.duracao_min, s.valor, id);
    totalServ++;
  });
});

const negocio = dados.negocio || {};
console.log(`Seed concluído — ${negocio.nome || '(sem nome)'}:`);
console.log(`  ${profissionais.length} profissional(is), ${totalServ} serviços`);
