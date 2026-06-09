// seed.js — popula o banco com a(s) profissional(is) e os serviços.
// Rode UMA vez (ou sempre que mudar profissionais/serviços): npm run seed
require('dotenv').config();
const db = require('./db');

// Limpa (idempotente para re-seed em desenvolvimento)
db.exec('DELETE FROM profissionais; DELETE FROM servicos;');

// ---- Profissional(is) ----
// calendar_id: para agenda compartilhada de Gmail pessoal, costuma ser o próprio e-mail.
// subject_email: deixe NULL se você usou o caminho "agenda compartilhada".
//
// foto_url: foto redonda exibida na escolha da profissional. Aceita:
//   - caminho local servido pelo Express:  '/fotos/patricia.jpg'
//     (coloque o arquivo em  public/fotos/patricia.jpg)
//   - URL externa:                          'https://exemplo.com/foto.jpg'
//   - vazio/null:                            mostra só a inicial do nome (molde redondo)
const profissionais = [
  {
    id: 1,
    nome: 'Bya Marcondes',
    calendar_id: 'parlloncomercial@gmail.com',
    subject_email: null,
    foto_url: '/fotos/foto_bya.jpeg', // troque pelo arquivo real, ou deixe '' pra usar a inicial
  },
  { id: 2, 
    nome: 'Joana Profissional', 
    calendar_id: 'outra@gmail.com', 
    subject_email: null, 
    foto_url: '/fotos/joana.jpg' },
  // Exemplos pra quando entrar mais gente:
  // { id: 2, nome: 'Joana Profissional', calendar_id: 'outra@gmail.com', subject_email: null, foto_url: '/fotos/joana.jpg' },
  // { id: 3, nome: 'Carla Souza',        calendar_id: 'carla@gmail.com', subject_email: null, foto_url: '' }, // sem foto -> inicial
];

const insProf = db.prepare(
  'INSERT INTO profissionais (id, nome, calendar_id, subject_email, foto_url) VALUES (?, ?, ?, ?, ?)'
);
profissionais.forEach((p) =>
  insProf.run(p.id, p.nome, p.calendar_id, p.subject_email, p.foto_url || null)
);

// ---- Serviços ----
const servicos = [
  { nome: 'Manicure', duracao_min: 60, valor: 25.0 },
  { nome: 'Pedicure', duracao_min: 60, valor: 25.0 },
  { nome: 'Manicure + Pedicure', duracao_min: 120, valor: 50.0 },
  { nome: 'Banho de Gel', duracao_min: 150, valor: 95.0 },
  { nome: 'Aplicação de unha Postiça', duracao_min: 90, valor: 45.0 },
  { nome: 'Molde F1, Unhas de Fibra, Speed Tip Gel', duracao_min: 210, valor: 170.0 },
  { nome: 'Manutenção: Banho de Gel', duracao_min: 150, valor: 75.0 },
  { nome: 'Manutenção: Reconstrução por Unha', duracao_min: 30, valor: 10.0 },
  { nome: 'Manutenção: Molde F1, Unhas de Fibra', duracao_min: 150, valor: 90.0 },
];

const insServ = db.prepare(
  'INSERT INTO servicos (nome, duracao_min, valor) VALUES (?, ?, ?)'
);
servicos.forEach((s) => insServ.run(s.nome, s.duracao_min, s.valor));

console.log('Seed concluído:');
console.log(`  ${profissionais.length} profissional(is)`);
console.log(`  ${servicos.length} serviços`);
