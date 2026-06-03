// seed.js — popula o banco com a manicure e os serviços.
// Rode UMA vez: npm run seed
require("dotenv").config();
const db = require("./db");

// Limpa (idempotente para re-seed em desenvolvimento)
db.exec("DELETE FROM profissionais; DELETE FROM servicos;");

// ---- Profissional(is) ----
// calendar_id: para agenda compartilhada de Gmail pessoal, costuma ser o próprio e-mail.
// subject_email: deixe NULL se você usou o caminho "agenda compartilhada".
const profissionais = [
  {
    id: 1,
    nome: "Patrícia Lima",
    calendar_id: "parlloncomercial@gmail.com",
    subject_email: null,
  },
  {
    id: 2,
    nome: "Joana Profissional",
    calendar_id: "8188ee81c51e514e02e0287df6769dd97709e1f1808b73ae7d5eabf81935e2d1@group.calendar.google.com",
    subject_email: null,
  },
  // Adicione mais profissionais aqui se houver mais de uma manicure:
  // { id: 2, nome: 'Outra Manicure', calendar_id: 'outra@gmail.com', subject_email: null },
];

const insProf = db.prepare(
  "INSERT INTO profissionais (id, nome, calendar_id, subject_email) VALUES (?, ?, ?, ?)",
);
profissionais.forEach((p) =>
  insProf.run(p.id, p.nome, p.calendar_id, p.subject_email),
);

// ---- Serviços ----
const servicos = [
  { nome: "Manicure Simples", duracao_min: 40, valor: 35.0 },
  { nome: "Pedicure", duracao_min: 50, valor: 45.0 },
  { nome: "Manicure + Pedicure", duracao_min: 80, valor: 70.0 },
  { nome: "Esmaltação em Gel", duracao_min: 60, valor: 65.0 },
  { nome: "Alongamento em Fibra de Vidro", duracao_min: 120, valor: 150.0 },
  { nome: "Spa dos Pés", duracao_min: 60, valor: 80.0 },
];

const insServ = db.prepare(
  "INSERT INTO servicos (nome, duracao_min, valor) VALUES (?, ?, ?)",
);
servicos.forEach((s) => insServ.run(s.nome, s.duracao_min, s.valor));

console.log("Seed concluído:");
console.log(`  ${profissionais.length} profissional(is)`);
console.log(`  ${servicos.length} serviços`);
