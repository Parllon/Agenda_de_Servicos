// clientes.js — listar, ler e gravar a configuração de cada cliente.
// Cada cliente vive em <PROJETO_RAIZ>/clientes/<slug>/ com .env + dados.json.
// O PROJETO_RAIZ tem que ser o MESMO caminho absoluto do host (ver docker-compose do painel),
// senão o "Aplicar" (docker compose) montaria volumes em caminhos que não existem.

const fs = require('fs');
const path = require('path');
const { parseEnv, updateEnv } = require('./env');

const PROJETO_RAIZ = process.env.PROJETO_RAIZ || '/DATA/Agendamento';
const DIR_CLIENTES = path.join(PROJETO_RAIZ, 'clientes');

// Listas de validação — espelham novo-cliente.sh e a doc §10.
const TEMAS = ['tema_1', 'tema_2', 'tema_3', 'tema_4', 'tema_5', 'tema_6', 'tema_7', 'tema_8'];
const PERFIS = ['profissional', 'barbeiro', 'terapeuta', 'cabeleireiro', 'designer', 'tatuador', 'especialista'];

// Chaves do .env que o painel deixa editar (o resto fica como está no arquivo).
const ENV_EDITAVEIS = [
  'PORTA_EXTERNA', 'TEMA', 'PERFIL_PROFISSIONAL',
  'EXPEDIENTE_INICIO', 'EXPEDIENTE_FIM', 'FOLGAS', 'SLOT_STEP_MIN',
  'JANELA_DIAS', 'ANTECEDENCIA_MIN', 'LEMBRETE_VESPERA_HORA',
  'WHATSAPP_INSTANCE', 'CORS_ORIGIN', 'LANDING_URL',
  // WhatsApp central + avisos (ver DOCUMENTACAO §8.6/§8.7)
  'WHATSAPP_MODE', 'WHATSAPP_INSTANCE_CENTRAL',
  'WHATSAPP_PREFIXO_NOME', 'WHATSAPP_PREFIXO_LABEL', 'WHATSAPP_INSTANCE_AVISOS',
];

function dirCliente(slug) {
  return path.join(DIR_CLIENTES, slug);
}

// Slug válido = igual ao que o novo-cliente.sh aceita: sem espaços nem barras.
function slugValido(slug) {
  return typeof slug === 'string' && /^[a-zA-Z0-9._-]+$/.test(slug);
}

function existe(slug) {
  return fs.existsSync(path.join(dirCliente(slug), '.env'));
}

// Lê só o que dá pra ler com segurança; se um arquivo estiver quebrado, marca o erro.
function listar() {
  if (!fs.existsSync(DIR_CLIENTES)) return [];
  return fs.readdirSync(DIR_CLIENTES, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name !== '_template')
    .map((d) => {
      const slug = d.name;
      const resumo = { slug, nome: slug, porta: '', tema: '', erro: null };
      try {
        const env = parseEnv(fs.readFileSync(path.join(dirCliente(slug), '.env'), 'utf8'));
        resumo.porta = env.PORTA_EXTERNA || '';
        resumo.tema = env.TEMA || '';
      } catch (e) { resumo.erro = 'erro ao ler .env'; }
      try {
        const dados = JSON.parse(fs.readFileSync(path.join(dirCliente(slug), 'dados.json'), 'utf8'));
        resumo.nome = (dados.negocio && dados.negocio.nome) || slug;
      } catch (e) { resumo.erro = 'dados.json inválido'; }
      return resumo;
    })
    .sort((a, b) => a.slug.localeCompare(b.slug));
}

// Devolve { dados, env } onde env é só o subconjunto editável.
function ler(slug) {
  if (!existe(slug)) throw new Error(`cliente '${slug}' não existe`);
  const dados = JSON.parse(fs.readFileSync(path.join(dirCliente(slug), 'dados.json'), 'utf8'));
  const todoEnv = parseEnv(fs.readFileSync(path.join(dirCliente(slug), '.env'), 'utf8'));
  const env = {};
  for (const k of ENV_EDITAVEIS) env[k] = todoEnv[k] ?? '';
  return { dados, env };
}

// Portas já usadas por outros clientes (para barrar duplicidade). Ignora `excetoSlug`.
function portasEmUso(excetoSlug) {
  const usadas = {};
  for (const c of listar()) {
    if (c.slug === excetoSlug) continue;
    if (c.porta) usadas[c.porta] = c.slug;
  }
  return usadas;
}

// Valida o pacote { dados, env } antes de gravar. Lança Error com mensagem amigável.
function validar({ dados, env }, slug) {
  if (!dados || typeof dados !== 'object') throw new Error('dados.json ausente ou inválido.');
  if (!dados.negocio || !dados.negocio.nome) throw new Error('Informe o nome do negócio.');

  const profs = Array.isArray(dados.profissionais) ? dados.profissionais : [];
  if (!profs.length) throw new Error('Cadastre pelo menos 1 profissional.');
  profs.forEach((p, i) => {
    if (!p.nome) throw new Error(`Profissional #${i + 1}: informe o nome.`);
    const servs = Array.isArray(p.servicos) ? p.servicos : [];
    if (!servs.length) throw new Error(`Profissional "${p.nome}": cadastre pelo menos 1 serviço.`);
  });

  if (env) {
    if (env.TEMA && !TEMAS.includes(env.TEMA)) throw new Error(`Tema inválido: ${env.TEMA}.`);
    if (env.PERFIL_PROFISSIONAL && !PERFIS.includes(env.PERFIL_PROFISSIONAL)) {
      throw new Error(`Perfil inválido: ${env.PERFIL_PROFISSIONAL}.`);
    }
    if (env.PORTA_EXTERNA) {
      const dono = portasEmUso(slug)[String(env.PORTA_EXTERNA)];
      if (dono) throw new Error(`Porta ${env.PORTA_EXTERNA} já está em uso por "${dono}".`);
    }
  }
}

// Normaliza ids dos profissionais (1,2,3...) e tipos numéricos dos serviços.
function normalizarDados(dados) {
  (dados.profissionais || []).forEach((p, i) => {
    p.id = i + 1;
    (p.servicos || []).forEach((s) => {
      s.duracao_min = Number(s.duracao_min) || 0;
      s.valor = Number(s.valor) || 0;
    });
  });
  return dados;
}

// Grava dados.json (bonito) e atualiza só as chaves editáveis do .env.
function gravar(slug, { dados, env }) {
  if (!existe(slug)) throw new Error(`cliente '${slug}' não existe`);
  validar({ dados, env }, slug);
  normalizarDados(dados);

  const caminhoDados = path.join(dirCliente(slug), 'dados.json');
  fs.writeFileSync(caminhoDados, JSON.stringify(dados, null, 2) + '\n', 'utf8');

  if (env) {
    const caminhoEnv = path.join(dirCliente(slug), '.env');
    const updates = {};
    for (const k of ENV_EDITAVEIS) {
      if (env[k] !== undefined && env[k] !== '') updates[k] = env[k];
    }
    const texto = fs.readFileSync(caminhoEnv, 'utf8');
    fs.writeFileSync(caminhoEnv, updateEnv(texto, updates), 'utf8');
  }
}

module.exports = {
  PROJETO_RAIZ, DIR_CLIENTES, TEMAS, PERFIS, ENV_EDITAVEIS,
  dirCliente, slugValido, existe, listar, ler, gravar, validar, portasEmUso, normalizarDados,
};
