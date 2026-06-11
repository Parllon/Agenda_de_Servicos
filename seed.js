// seed.js — popula o banco com a(s) profissional(is) e os serviços de cada uma.
// Rode UMA vez (ou sempre que mudar profissionais/serviços): npm run seed
//
// Opção B: cada serviço PERTENCE a uma profissional (campo "servicos" dentro dela).
//
// MULTI-NICHO: o conjunto de dados é escolhido pelo .env.
//   SEED=barbearia  -> popula a barbearia (exemplos abaixo)
//   (sem SEED)      -> usa o TEMA; e se não houver, cai em 'manicure'
// Assim a MESMA base de código atende vários clientes — cada instância tem seu
// próprio banco (volume Docker separado), então os ids não conflitam entre elas.
require("dotenv").config();
const db = require("./db");

const CONJUNTO = process.env.SEED || process.env.TEMA || "manicure";

// calendar_id: para agenda de Gmail pessoal é o próprio e-mail; para agenda
//   secundária é o ID "...@group.calendar.google.com" (veja em Integrar agenda).
//   A agenda PRECISA estar compartilhada com a service account ("Fazer alterações
//   nos eventos") — senão lê os horários mas FALHA ao gravar o agendamento.
// foto_url: '/fotos/arquivo.jpg' (em public/fotos/), URL externa, ou vazio (inicial).
const DADOS = {
  // ===== Manicure (Bya) =====
  manicure: [
    {
      id: 1,
      nome: "Bya Marcondes",
      calendar_id: "parlloncomercial@gmail.com",
      subject_email: null,
      foto_url: "/fotos/foto_bya.jpeg",
      servicos: [
        { nome: "Manicure", duracao_min: 60, valor: 25.0 },
        { nome: "Pedicure", duracao_min: 60, valor: 25.0 },
        { nome: "Manicure + Pedicure", duracao_min: 120, valor: 50.0 },
        { nome: "Banho de Gel", duracao_min: 150, valor: 95.0 },
        { nome: "Aplicação de unha Postiça", duracao_min: 90, valor: 45.0 },
        {
          nome: "Molde F1, Unhas de Fibra, Speed Tip Gel",
          duracao_min: 210,
          valor: 170.0,
        },
        { nome: "Manutenção: Banho de Gel", duracao_min: 150, valor: 75.0 },
        {
          nome: "Manutenção: Reconstrução por Unha",
          duracao_min: 30,
          valor: 10.0,
        },
        {
          nome: "Manutenção: Molde F1, Unhas de Fibra",
          duracao_min: 150,
          valor: 90.0,
        },
      ],
    },
    // 2ª profissional (cabeleireira) — exemplo. Para ativar: descomente, troque o
    // calendar_id pela agenda real e rode o seed de novo.
    /*
    {
      id: 2, nome: 'Joana — Cabeleireira',
      calendar_id: 'AGENDA_REAL_AQUI@gmail.com', subject_email: null, foto_url: '',
      servicos: [
        { nome: 'Corte feminino', duracao_min: 60, valor: 70.0 },
        { nome: 'Escova', duracao_min: 45, valor: 50.0 },
        { nome: 'Coloração', duracao_min: 120, valor: 180.0 },
        { nome: 'Hidratação', duracao_min: 60, valor: 90.0 },
      ],
    },
    */
  ],
  carol: [
    {
      id: 1,
      nome: "Carol Figueira",
      calendar_id: "parlloncomercial@gmail.com",
      subject_email: null,
      foto_url: "/fotos/foto_julia.png",
      servicos: [
        { nome: "Manicure", duracao_min: 60, valor: 25.0 },
        { nome: "Pedicure", duracao_min: 60, valor: 25.0 },
        { nome: "Manicure + Pedicure", duracao_min: 120, valor: 50.0 },
        { nome: "Banho de Gel", duracao_min: 150, valor: 95.0 },
        { nome: "Aplicação de unha Postiça", duracao_min: 90, valor: 45.0 },
        {
          nome: "Molde F1, Unhas de Fibra, Speed Tip Gel",
          duracao_min: 210,
          valor: 170.0,
        },
        { nome: "Manutenção: Banho de Gel", duracao_min: 150, valor: 75.0 },
        {
          nome: "Manutenção: Reconstrução por Unha",
          duracao_min: 30,
          valor: 10.0,
        },
        {
          nome: "Manutenção: Molde F1, Unhas de Fibra",
          duracao_min: 150,
          valor: 90.0,
        },
      ],
    },
    // 2ª profissional (cabeleireira) — exemplo. Para ativar: descomente, troque o
    // calendar_id pela agenda real e rode o seed de novo.
    /*
{
  id: 2, nome: 'Joana — Cabeleireira',
  calendar_id: 'AGENDA_REAL_AQUI@gmail.com', subject_email: null, foto_url: '',
  servicos: [
    { nome: 'Corte feminino', duracao_min: 60, valor: 70.0 },
    { nome: 'Escova', duracao_min: 45, valor: 50.0 },
    { nome: 'Coloração', duracao_min: 120, valor: 180.0 },
    { nome: 'Hidratação', duracao_min: 60, valor: 90.0 },
  ],
},
*/
  ],

  // ===== Barbearia (exemplos p/ testar — Navalha de Ouro) =====
  // IMPORTANTE: os calendar_id abaixo são PLACEHOLDERS. Para testar o agendamento
  // de verdade, troque cada um pela agenda Google real do barbeiro (compartilhada
  // com a service account). Para só testar o visual/fluxo, pode deixar como está
  // (os horários aparecem, mas a confirmação vai falhar até pôr uma agenda real).
  // Dica p/ teste rápido: use 'parlloncomercial@gmail.com' (já compartilhada).
  barbearia: [
    {
      id: 1,
      nome: "Rafael",
      calendar_id:
        "ddb5042a0f757b08ee4261ff3413ffe60d93be95e830c05826e52a219736fe10@group.calendar.google.com",
      subject_email: null,
      foto_url: "", // sem foto -> mostra a inicial
      servicos: [
        { nome: "Corte", duracao_min: 30, valor: 40.0 },
        { nome: "Barba", duracao_min: 30, valor: 35.0 },
        { nome: "Corte + Barba", duracao_min: 60, valor: 70.0 },
        { nome: "Pezinho (acabamento)", duracao_min: 15, valor: 20.0 },
      ],
    },
    {
      id: 2,
      nome: "Diego",
      calendar_id:
        "7a8561fb7398017602d4529248bb2c0b3ed210ec342a2548e9aa3b2d0137aec2@group.calendar.google.com",
      subject_email: null,
      foto_url: "",
      servicos: [
        { nome: "Corte Degradê", duracao_min: 45, valor: 50.0 },
        { nome: "Barboterapia", duracao_min: 45, valor: 45.0 },
        { nome: "Sobrancelha", duracao_min: 15, valor: 15.0 },
        { nome: "Platinado / Descoloração", duracao_min: 120, valor: 160.0 },
      ],
    },
  ],
};

const profissionais = DADOS[CONJUNTO] || DADOS.manicure;

// Limpa (idempotente para re-seed)
db.exec("DELETE FROM profissionais; DELETE FROM servicos;");

const insProf = db.prepare(
  "INSERT INTO profissionais (id, nome, calendar_id, subject_email, foto_url) VALUES (?, ?, ?, ?, ?)",
);
const insServ = db.prepare(
  "INSERT INTO servicos (nome, duracao_min, valor, profissional_id) VALUES (?, ?, ?, ?)",
);

let totalServ = 0;
profissionais.forEach((p) => {
  insProf.run(p.id, p.nome, p.calendar_id, p.subject_email, p.foto_url || null);
  (p.servicos || []).forEach((s) => {
    insServ.run(s.nome, s.duracao_min, s.valor, p.id);
    totalServ++;
  });
});

console.log(`Seed (${CONJUNTO}) concluído:`);
console.log(`  ${profissionais.length} profissional(is)`);
console.log(`  ${totalServ} serviços (vinculados às profissionais)`);
