// db.js — banco leve (SQLite). Necessário para o cron de lembretes ser idempotente.
const Database = require('better-sqlite3');
 
// Caminho configurável: em Docker apontamos para o volume (/data/agendamentos.db).
// Local (sem Docker), cai no padrão na pasta do projeto.
const db = new Database(process.env.DB_PATH || 'agendamentos.db');
 
db.pragma('journal_mode = WAL'); // melhor concorrência leitura/escrita
 
db.exec(`
  CREATE TABLE IF NOT EXISTS profissionais (
    id INTEGER PRIMARY KEY,
    nome TEXT NOT NULL,
    calendar_id TEXT NOT NULL,        -- ID da agenda Google
    subject_email TEXT                -- usado só em Domain-Wide Delegation (senão NULL)
  );
 
  CREATE TABLE IF NOT EXISTS servicos (
    id INTEGER PRIMARY KEY,
    nome TEXT NOT NULL,
    duracao_min INTEGER NOT NULL,
    valor REAL NOT NULL
  );
 
  CREATE TABLE IF NOT EXISTS agendamentos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    google_event_id TEXT,
    profissional_id INTEGER,
    servico_nome TEXT,
    cliente_nome TEXT,
    cliente_telefone TEXT,            -- E.164 sem '+': 5521999998888
    inicio TEXT NOT NULL,             -- ISO 8601
    fim TEXT NOT NULL,
    status TEXT DEFAULT 'confirmado', -- confirmado | cancelado
    lembrete_enviado INTEGER DEFAULT 0,
    criado_em TEXT DEFAULT (datetime('now'))
  );
 
  CREATE INDEX IF NOT EXISTS idx_ag_lembrete
    ON agendamentos (status, lembrete_enviado, inicio);
`);
 
// Migração segura: adiciona a coluna do lembrete da véspera se ainda não existir.
// (CREATE TABLE IF NOT EXISTS não altera tabelas já criadas em bancos antigos.)
const colunas = db.prepare('PRAGMA table_info(agendamentos)').all().map((c) => c.name);
if (!colunas.includes('lembrete_vespera_enviado')) {
  db.exec('ALTER TABLE agendamentos ADD COLUMN lembrete_vespera_enviado INTEGER DEFAULT 0');
}
 
module.exports = db;