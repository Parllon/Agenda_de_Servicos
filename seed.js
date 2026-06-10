// seed.js — popula o banco com a(s) profissional(is) e os serviços de cada uma.
// Rode UMA vez (ou sempre que mudar profissionais/serviços): npm run seed
//
// Opção B: cada serviço PERTENCE a uma profissional. Por isso os serviços ficam
// DENTRO de cada profissional (campo "servicos"), e são gravados já vinculados a ela.
require('dotenv').config();
const db = require('./db');

// Limpa (idempotente para re-seed em desenvolvimento)
db.exec('DELETE FROM profissionais; DELETE FROM servicos;');

// calendar_id: para agenda compartilhada de Gmail pessoal, costuma ser o próprio e-mail.
// subject_email: deixe null se você usou o caminho "agenda compartilhada".
// foto_url: '/fotos/arquivo.jpg' (em public/fotos/), URL externa, ou vazio (mostra a inicial).
const profissionais = [
  {
    id: 1,
    nome: 'Bya Marcondes',
    calendar_id: 'parlloncomercial@gmail.com',
    subject_email: null,
    foto_url: '/fotos/foto_bya.jpeg',
    servicos: [
      { nome: 'Manicure', duracao_min: 60, valor: 25.0 },
      { nome: 'Pedicure', duracao_min: 60, valor: 25.0 },
      { nome: 'Manicure + Pedicure', duracao_min: 120, valor: 50.0 },
      { nome: 'Banho de Gel', duracao_min: 150, valor: 95.0 },
      { nome: 'Aplicação de unha Postiça', duracao_min: 90, valor: 45.0 },
      { nome: 'Molde F1, Unhas de Fibra, Speed Tip Gel', duracao_min: 210, valor: 170.0 },
      { nome: 'Manutenção: Banho de Gel', duracao_min: 150, valor: 75.0 },
      { nome: 'Manutenção: Reconstrução por Unha', duracao_min: 30, valor: 10.0 },
      { nome: 'Manutenção: Molde F1, Unhas de Fibra', duracao_min: 150, valor: 90.0 },
    ],
  },

  // ---- EXEMPLO de uma 2ª profissional com serviços DIFERENTES (cabeleireira) ----
  // Mostra a Opção B na prática: ao escolher esta profissional, só os serviços
  // ABAIXO aparecem (os da Bya não). Para ATIVAR:
  //   1) tire o /* e o */ que cercam o bloco;
  //   2) troque o calendar_id pela agenda Google REAL dela (compartilhada com a
  //      service account) — senão o agendamento dá erro ao gravar no Google;
  //   3) rode `npm run seed` de novo.

  {
    id: 2,
    nome: 'Joana — Cabeleireira',
    calendar_id: '8188ee81c51e514e02e0287df6769dd97709e1f1808b73ae7d5eabf81935e2d1@group.calendar.google.com',
    subject_email: null,
    foto_url: '', // sem foto -> mostra a inicial do nome
    servicos: [
      { nome: 'Corte feminino', duracao_min: 60, valor: 70.0 },
      { nome: 'Escova', duracao_min: 45, valor: 50.0 },
      { nome: 'Coloração', duracao_min: 120, valor: 180.0 },
      { nome: 'Hidratação', duracao_min: 60, valor: 90.0 },
    ],
  },

];

const insProf = db.prepare(
  'INSERT INTO profissionais (id, nome, calendar_id, subject_email, foto_url) VALUES (?, ?, ?, ?, ?)'
);
const insServ = db.prepare(
  'INSERT INTO servicos (nome, duracao_min, valor, profissional_id) VALUES (?, ?, ?, ?)'
);

let totalServ = 0;
profissionais.forEach((p) => {
  insProf.run(p.id, p.nome, p.calendar_id, p.subject_email, p.foto_url || null);
  (p.servicos || []).forEach((s) => {
    insServ.run(s.nome, s.duracao_min, s.valor, p.id);
    totalServ++;
  });
});

console.log('Seed concluído:');
console.log(`  ${profissionais.length} profissional(is)`);
console.log(`  ${totalServ} serviços (vinculados às profissionais)`);
