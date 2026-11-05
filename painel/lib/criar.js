// criar.js — cria a estrutura de um cliente novo. Mesma intenção do novo-cliente.sh,
// mas em JS. Em vez de copiar o _template e reescrever (cpSync recursivo dá EPERM em
// share SMB), lemos cada arquivo do molde em memória e gravamos a versão final direto.

const fs = require('fs');
const path = require('path');
const { updateEnv } = require('./env');
const C = require('./clientes');
const { novoSegredo } = require('./agenda-links');

const TEMPLATE = path.join(C.PROJETO_RAIZ, 'clientes', '_template');

// Conexão com o WAHA (WhatsApp central). O molde versionado só tem o placeholder
// CHAVE_DO_WAHA — sem isto, todo cliente criado pelo painel nascia com chave
// inválida e TODO envio de WhatsApp (confirmação, lembretes, aviso à dona) dava
// 401. A chave real vive só no .env do painel (WAHA_API_KEY), nunca no Git.
function envWaha() {
  const chave = (process.env.WAHA_API_KEY || '').trim();
  if (!chave) {
    console.warn('[criar] AVISO: WAHA_API_KEY vazio no .env do painel — o cliente novo não vai conseguir enviar WhatsApp.');
    return {};
  }
  return {
    WAHA_URL: process.env.WAHA_URL || 'http://waha:3000',
    WAHA_API_KEY: chave,
    WAHA_SESSION: process.env.WAHA_SESSION || 'agendamento',
  };
}

// Recebe { slug, porta, tema, perfil, dados } e cria clientes/<slug>/.
function criar({ slug, porta, tema, perfil, dados }) {
  perfil = perfil || 'profissional';

  // --- validações (espelham novo-cliente.sh); falham ANTES de criar qualquer pasta ---
  if (!C.slugValido(slug)) throw new Error('Slug inválido. Use letras, números, ponto, hífen ou _ (sem espaços).');
  if (!porta || !/^\d+$/.test(String(porta))) throw new Error('Porta inválida (use só números).');
  if (tema !== 'custom' && !C.TEMAS.includes(tema)) throw new Error(`Tema inválido: ${tema}.`);
  if (tema === 'custom' && !C.HEX_COR.test(dados?.negocio?.tema_custom?.cor_primaria || '')) {
    throw new Error('Tema customizado: informe uma cor primária válida (#RRGGBB).');
  }
  if (!C.PERFIS.includes(perfil)) throw new Error(`Perfil inválido: ${perfil}.`);
  if (C.existe(slug) || fs.existsSync(C.dirCliente(slug))) {
    throw new Error(`Já existe um cliente '${slug}'. Escolha outro slug.`);
  }
  const dono = C.portasEmUso()[String(porta)];
  if (dono) throw new Error(`Porta ${porta} já está em uso por "${dono}".`);
  if (!fs.existsSync(TEMPLATE)) throw new Error(`Molde não encontrado em ${TEMPLATE}.`);
  if (dados) { C.validar({ dados }, slug); C.normalizarDados(dados); }

  // --- ler o molde em memória ---
  const envMolde = fs.readFileSync(path.join(TEMPLATE, '.env'), 'utf8');
  const composeMolde = fs.readFileSync(path.join(TEMPLATE, 'docker-compose.yml'), 'utf8');
  const dadosFinal = dados
    ? JSON.stringify(dados, null, 2) + '\n'
    : fs.readFileSync(path.join(TEMPLATE, 'dados.json'), 'utf8');

  // --- gerar o .env final já com os 5 campos da identidade ajustados ---
  const envFinal = updateEnv(envMolde, {
    CLIENTE: slug,
    PORTA_EXTERNA: String(porta),
    TEMA: tema,
    PERFIL_PROFISSIONAL: perfil,
    WHATSAPP_INSTANCE: slug,
    ...envWaha(),
    // Segredo dos links da agenda por assinatura (iPhone) — ver app/agenda-ics.js.
    AGENDA_ICS_SEGREDO: novoSegredo(),
  });

  // --- criar a estrutura e gravar (sem cpSync) ---
  const dir = C.dirCliente(slug);
  fs.mkdirSync(path.join(dir, 'banco_dados'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'fotos'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.env'), envFinal, 'utf8');
  fs.writeFileSync(path.join(dir, 'docker-compose.yml'), composeMolde, 'utf8');
  fs.writeFileSync(path.join(dir, 'dados.json'), dadosFinal, 'utf8');

  return { slug, porta, tema, perfil };
}

module.exports = { criar };
