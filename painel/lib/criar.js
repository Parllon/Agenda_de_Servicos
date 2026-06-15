// criar.js — cria a estrutura de um cliente novo. Mesma intenção do novo-cliente.sh,
// mas em JS. Em vez de copiar o _template e reescrever (cpSync recursivo dá EPERM em
// share SMB), lemos cada arquivo do molde em memória e gravamos a versão final direto.

const fs = require('fs');
const path = require('path');
const { updateEnv } = require('./env');
const C = require('./clientes');

const TEMPLATE = path.join(C.PROJETO_RAIZ, 'clientes', '_template');

// Recebe { slug, porta, tema, perfil, dados } e cria clientes/<slug>/.
function criar({ slug, porta, tema, perfil, dados }) {
  perfil = perfil || 'profissional';

  // --- validações (espelham novo-cliente.sh); falham ANTES de criar qualquer pasta ---
  if (!C.slugValido(slug)) throw new Error('Slug inválido. Use letras, números, ponto, hífen ou _ (sem espaços).');
  if (!porta || !/^\d+$/.test(String(porta))) throw new Error('Porta inválida (use só números).');
  if (!C.TEMAS.includes(tema)) throw new Error(`Tema inválido: ${tema}.`);
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
