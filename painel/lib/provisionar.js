// provisionar.js — cria um cliente de ponta a ponta a partir de um pedido do site,
// SEM ninguém clicar em nada. É a mesma sequência que o wizard do painel faz pelo
// navegador (public/cadastro.js → criarCliente), só que aqui no servidor:
//
//   config (criar + .env) → agendas Google → almoço → fotos → docker (aplicar) → DNS/túnel
//
// Roda numa FILA SERIAL: um pedido por vez. Dois pedidos ao mesmo tempo pegariam
// a mesma porta em C.proximaPorta() e brigariam pelo cloudflared_config.yml.
//
// Cada fase concluída fica marcada no registro (pedidos-store), então reprocessar
// um pedido que falhou continua de onde parou em vez de recriar tudo.

'use strict';
const fs = require('fs');
const path = require('path');
const C = require('./clientes');
const S = require('./pedidos-store');
const { updateEnv } = require('./env');
const { criar } = require('./criar');
const { aplicar } = require('./aplicar');
const { criarAgendasDoCliente } = require('./agendas');
const { sincronizarCliente } = require('./pausas');
const { registrarDNS, atualizarConfig, reloadCloudflared } = require('./cloudflare');
const { paraConfig, escolherSlug, DOMINIO } = require('./pedido');

// Fotos recebidas ficam aqui até o cliente existir (permite reprocessar depois).
const DIR_FOTOS = path.join(S.DIR, 'fotos');
const FOTO_MAX_BYTES = 600 * 1024;
const PREFIXO_JPEG = 'data:image/jpeg;base64,';

// ---------------------------------------------------------------------------
// Fotos: valida a data URL e guarda o JPEG. Nunca lança — foto ruim vira aviso.
// ---------------------------------------------------------------------------
function guardarFotos(pedido) {
  const avisos = [];
  pedido.profissionais.forEach((pr, i) => {
    const foto = pr.foto;
    pr.foto = null; // o registro guarda o pedido sem a imagem
    if (!foto) return;
    const nome = pr.nome || `profissional ${i + 1}`;
    if (typeof foto !== 'string' || !foto.startsWith(PREFIXO_JPEG)) {
      avisos.push(`${nome}: foto ignorada (formato não é JPEG).`);
      return;
    }
    const buf = Buffer.from(foto.slice(PREFIXO_JPEG.length), 'base64');
    // Assinatura de JPEG: FF D8 FF. Barra arquivo "renomeado" ou lixo.
    if (buf.length < 100 || buf[0] !== 0xff || buf[1] !== 0xd8 || buf[2] !== 0xff) {
      avisos.push(`${nome}: foto ignorada (arquivo inválido).`);
      return;
    }
    if (buf.length > FOTO_MAX_BYTES) {
      avisos.push(`${nome}: foto ignorada (maior que ${FOTO_MAX_BYTES / 1024} KB).`);
      return;
    }
    fs.mkdirSync(DIR_FOTOS, { recursive: true });
    fs.writeFileSync(path.join(DIR_FOTOS, `${pedido.protocolo}-${i + 1}.jpg`), buf);
    pr.foto = 'recebida';
  });
  return avisos;
}

function fotosPendentes(protocolo) {
  if (!fs.existsSync(DIR_FOTOS)) return [];
  const re = new RegExp(`^${protocolo}-(\\d+)\\.jpg$`);
  return fs.readdirSync(DIR_FOTOS)
    .map((f) => { const m = f.match(re); return m ? { arquivo: path.join(DIR_FOTOS, f), id: Number(m[1]) } : null; })
    .filter(Boolean);
}

// ---------------------------------------------------------------------------
// Fases
// ---------------------------------------------------------------------------
async function faseConfig(reg) {
  // Alguém pegou o slug entre o pedido e agora (ex.: wizard manual)? Escolhe outro.
  if (C.existe(reg.slug)) {
    reg.slug = escolherSlug(reg.pedido);
    reg.url = `https://${reg.slug}.${DOMINIO}`;
  }
  const conf = paraConfig(reg.pedido, { slug: reg.slug });
  const porta = C.proximaPorta();
  criar({ slug: reg.slug, porta, tema: conf.tema, perfil: conf.perfil, dados: conf.dados });
  // .env direto pelo updateEnv (e não C.gravar): C.gravar ignora valor vazio, e
  // FOLGAS="" (aberto todo dia) precisa ser gravado de verdade.
  const arqEnv = path.join(C.dirCliente(reg.slug), '.env');
  // CADASTRO_PROTOCOLO: o motor reconhece o "oi" do dono por ele e responde com
  // o link da página e da agenda (app/server.js → ehMensagemDoDono).
  const env = { ...conf.env, CADASTRO_PROTOCOLO: reg.protocolo };
  fs.writeFileSync(arqEnv, updateEnv(fs.readFileSync(arqEnv, 'utf8'), env), 'utf8');
  reg.porta = porta;
  reg.avisos.push(...conf.avisos);
}

async function faseGoogle(reg) {
  const { dados } = C.ler(reg.slug);
  const r = await criarAgendasDoCliente(dados); // muta dados (calendar_id)
  C.gravar(reg.slug, { dados });
  if (r.erros.length) {
    throw new Error(r.erros.map((e) => `${e.profissional || ''}: ${e.erro}`).join('; '));
  }
}

// Almoço de cada profissional vira evento recorrente na agenda dele (lib/pausas.js).
// Depois de "google" (precisa do calendar_id). Não mexe no banco do motor, então
// não obriga a refazer o docker. Qualquer aviso conta como falha: o pedido fica
// reprocessável e o almoço vai para a agenda na próxima tentativa.
async function faseAlmoco(reg) {
  const { dados, env } = C.ler(reg.slug);
  // "antes" = a própria ficha: num reprocessamento, quem já tem evento fica como está
  // (sem duplicar) e só os que faltam são criados.
  const r = await sincronizarCliente(structuredClone(dados), dados, { antes: env.FOLGAS, depois: env.FOLGAS });
  C.gravar(reg.slug, { dados });
  if (r.avisos.length) throw new Error(r.avisos.join('; '));
}

async function faseFotos(reg) {
  const fotos = fotosPendentes(reg.protocolo);
  if (!fotos.length) return;
  const { dados } = C.ler(reg.slug);
  const dirFotos = path.join(C.dirCliente(reg.slug), 'fotos');
  fs.mkdirSync(dirFotos, { recursive: true });
  for (const { arquivo, id } of fotos) {
    const prof = dados.profissionais.find((p) => p.id === id);
    if (!prof) continue;
    const nome = `prof-${id}.jpg`;
    fs.copyFileSync(arquivo, path.join(dirFotos, nome));
    prof.foto_url = `/fotos/${nome}`;
  }
  C.gravar(reg.slug, { dados });
  for (const { arquivo } of fotos) fs.rmSync(arquivo, { force: true });
}

async function faseDocker(reg) {
  reg.log_docker = (await aplicar(reg.slug)).slice(-4000);
}

async function faseDns(reg) {
  try {
    await registrarDNS(reg.slug);
  } catch (e) {
    // reprocessamento: o CNAME já existir não é erro
    if (!/already exists|já existe/i.test(e.message)) throw e;
  }
  const yml = fs.readFileSync(path.join(C.PROJETO_RAIZ, 'cloudflared_config.yml'), 'utf8');
  if (!yml.includes(`hostname: ${reg.slug}.${DOMINIO}`)) atualizarConfig(reg.slug, reg.porta);
}

// Ordem importa: agendas ANTES do docker (o seed lê calendar_id), fotos antes do
// seed (foto_url), DNS por último (o reload derruba o túnel por alguns segundos).
// `critica: false` = se falhar, anota e segue (dá pra corrigir depois sem refazer).
const FASES = [
  { nome: 'config', fn: faseConfig, critica: true },
  { nome: 'google', fn: faseGoogle, critica: false },
  { nome: 'almoco', fn: faseAlmoco, critica: false },
  { nome: 'fotos', fn: faseFotos, critica: false },
  { nome: 'docker', fn: faseDocker, critica: true },
  { nome: 'dns', fn: faseDns, critica: true },
];

async function executar(protocolo) {
  const reg = S.ler(protocolo);
  if (!reg) return;
  reg.status = 'provisionando';
  reg.erro = null;
  S.gravar(reg);

  const falhas = [];
  for (const fase of FASES) {
    if (reg.fases[fase.nome] === 'ok') continue;
    try {
      await fase.fn(reg);
      reg.fases[fase.nome] = 'ok';
      // Reprocessamento: agendas/fotos só agora deram certo, mas o docker já tinha
      // subido sem elas → roda o aplicar (seed) de novo para o banco pegar.
      if ((fase.nome === 'google' || fase.nome === 'fotos') && reg.fases.docker === 'ok') {
        delete reg.fases.docker;
      }
    } catch (e) {
      console.error(`[provisionar:${protocolo}] fase ${fase.nome}:`, e.message);
      reg.fases[fase.nome] = 'falhou';
      falhas.push(`${fase.nome}: ${e.message}`);
      if (fase.critica) break;
    } finally {
      S.gravar(reg);
    }
  }

  const criticaFalhou = FASES.some((f) => f.critica && reg.fases[f.nome] !== 'ok');
  reg.status = criticaFalhou ? 'erro' : 'pronto';
  reg.erro = falhas.length ? falhas.join('\n').slice(0, 2000) : null;
  S.gravar(reg);
  console.log(`[provisionar:${protocolo}] ${reg.status} → ${reg.url}`);

  // Reload do cloudflared por último: derruba o túnel por alguns segundos.
  if (reg.fases.dns === 'ok') {
    reloadCloudflared().catch((e) => console.error('[provisionar] reload cloudflared:', e.message));
  }
}

// ---------------------------------------------------------------------------
// Fila serial
// ---------------------------------------------------------------------------
let fila = Promise.resolve();

function enfileirar(protocolo) {
  const tarefa = fila.then(() => executar(protocolo));
  fila = tarefa.catch((e) => console.error(`[provisionar:${protocolo}] erro inesperado:`, e));
  return tarefa;
}

module.exports = { guardarFotos, enfileirar };
