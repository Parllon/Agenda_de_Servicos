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

  CREATE INDEX IF NOT EXISTS idx_ag_telefone
    ON agendamentos (cliente_telefone, status, inicio);
`);

// Migração segura: adiciona a coluna do lembrete da véspera se ainda não existir.
// (CREATE TABLE IF NOT EXISTS não altera tabelas já criadas em bancos antigos.)
const colunas = db.prepare('PRAGMA table_info(agendamentos)').all().map((c) => c.name);
if (!colunas.includes('lembrete_vespera_enviado')) {
  db.exec('ALTER TABLE agendamentos ADD COLUMN lembrete_vespera_enviado INTEGER DEFAULT 0');
}

// Migração segura: ID do evento na AGENDA CENTRAL do salão (Cenário 2 — gravação
// dupla). NULL = não houve cópia na central (Cenário 1/3, ou a gravação falhou).
if (!colunas.includes('google_event_id_central')) {
  db.exec('ALTER TABLE agendamentos ADD COLUMN google_event_id_central TEXT');
}

// Migração segura: coluna da foto da profissional (URL ou caminho em /public).
// Fica NULL/vazio quando não há foto — o frontend cai pra inicial do nome.
const colProf = db.prepare('PRAGMA table_info(profissionais)').all().map((c) => c.name);
if (!colProf.includes('foto_url')) {
  db.exec('ALTER TABLE profissionais ADD COLUMN foto_url TEXT');
}

// Migração segura: chat do Telegram da profissional (avisos de agendamento por
// profissional). NULL = aquela profissional não recebe aviso individual.
if (!colProf.includes('telegram_chat_id')) {
  db.exec('ALTER TABLE profissionais ADD COLUMN telegram_chat_id TEXT');
}

// Migração segura: vínculo serviço -> profissional (Opção B: cada serviço pertence
// a UMA profissional). Bancos antigos tinham 'servicos' como lista global.
const colServ = db.prepare('PRAGMA table_info(servicos)').all().map((c) => c.name);
if (!colServ.includes('profissional_id')) {
  db.exec('ALTER TABLE servicos ADD COLUMN profissional_id INTEGER');
}

module.exports = db;
