// temas.js — presets visuais reutilizáveis.
// O MESMO código serve a vários nichos; só o tema muda. Escolha pelo .env: TEMA=tema_3
//
// As cores são canais RGB ("R G B", sem vírgula) de propósito: assim o Tailwind
// consegue aplicar transparência (ex.: bg-wine/40) usando rgb(var(--c-wine) / .4).
// Mude SÓ os valores aqui — as classes no HTML/JS não precisam ser tocadas.
//
// Temas disponíveis:
//   tema_1 — Feminino Clássico   (vinho + marfim)        → manicure, nail designer
//   tema_2 — Masculino Clássico  (preto + dourado)        → barbearia tradicional
//   tema_3 — Spa & Estética      (verde esmeralda + branco clean) → spa, massagem, estética
//   tema_4 — Hair Salon          (rosa cerise + branco)   → cabeleireiro, coloração
//   tema_5 — Beauty Studio       (nude + caramelo)        → lash, sobrancelhas, micropigmentação
//   tema_6 — Ink & Art           (preto profundo + vermelho) → tatuagem, piercing
//   tema_7 — Luxo Premium        (branco pérola + champagne) → salão premium, clínica estética
//   tema_8 — Minimalista Mono    (branco + preto + cinza)    → estúdio, barbearia moderna, consultoria

const TEMAS = {

  // ── tema_1 — Feminino Clássico ──────────────────────────────────────────────
  tema_1: {
    cores: {
      ivory:     '251 246 240', // fundo creme quente
      wine:      '92 35 48',    // vinho (primária)
      wineDark:  '65 24 37',    // vinho escuro (hover / texto forte)
      blush:     '230 185 188', // rosé suave (bordas / realces)
      blushSoft: '243 222 223', // rosé muito suave (trilho / fundos)
      clay:      '201 138 142', // rosa-argila (texto secundário)
      gold:      '185 138 75',  // dourado (detalhe do cabeçalho)
      card:      '255 255 255', // cartão branco
    },
    fontes: { display: "'Fraunces', serif", body: "'Jost', sans-serif" },
    fonteUrl: 'https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,300..600&family=Jost:wght@300;400;500;600&display=swap',
    rotulos: {
      stepProfissional:  'Profissional',
      tituloProfissional:'Escolha a profissional',
      subProfissional:   'Quem cuidará de você hoje?',
      subServico:        'Selecione o cuidado desejado.',
      labelProfissional: 'Profissional',
    },
  },

  // ── tema_2 — Masculino Clássico ──────────────────────────────────────────────
  tema_2: {
    cores: {
      ivory:     '18 17 16',    // fundo quase preto quente
      wine:      '198 160 74',  // dourado (primária)
      wineDark:  '226 197 122', // dourado claro (hover / texto forte — "ilumina")
      blush:     '92 78 44',    // dourado escuro (bordas / realces sutis)
      blushSoft: '46 42 32',    // dourado muito escuro (trilho do progresso)
      clay:      '160 150 128', // bege-acinzentado (texto secundário)
      gold:      '249 227 30',  // amarelo-ouro (detalhe)
      card:      '30 28 24',    // cartão cinza-escuro
    },
    fontes: { display: "'Oswald', sans-serif", body: "'Barlow', sans-serif" },
    fonteUrl: 'https://fonts.googleapis.com/css2?family=Oswald:wght@300;400;500;600&family=Barlow:wght@300;400;500;600&display=swap',
    rotulos: {
      stepProfissional:  'Barbeiro',
      tituloProfissional:'Escolha o barbeiro',
      subProfissional:   'Quem vai te atender hoje?',
      subServico:        'Selecione o serviço desejado.',
      labelProfissional: 'Barbeiro',
    },
  },

  // ── tema_3 — Spa & Estética ─────────────────────────────────────────────────
  tema_3: {
    cores: {
      ivory:     '242 248 244', // fundo branco esverdeado suave
      wine:      '38 110 89',   // verde esmeralda (primária)
      wineDark:  '24 78 62',    // verde escuro (hover / texto forte)
      blush:     '155 208 185', // verde menta claro (bordas / realces)
      blushSoft: '212 235 225', // verde muito suave (trilho / fundos)
      clay:      '95 145 125',  // verde-cinza (texto secundário)
      gold:      '175 150 85',  // dourado suave (detalhe)
      card:      '255 255 255', // cartão branco
    },
    fontes: { display: "'Cormorant Garamond', serif", body: "'Raleway', sans-serif" },
    fonteUrl: 'https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,500;0,600;1,300&family=Raleway:wght@300;400;500;600&display=swap',
    rotulos: {
      stepProfissional:  'Terapeuta',
      tituloProfissional:'Escolha a terapeuta',
      subProfissional:   'Quem cuida de você hoje?',
      subServico:        'Selecione o tratamento desejado.',
      labelProfissional: 'Terapeuta',
    },
  },

  // ── tema_4 — Hair Salon ──────────────────────────────────────────────────────
  tema_4: {
    cores: {
      ivory:     '252 246 250', // fundo branco com toque rosado
      wine:      '200 52 98',   // rosa cerise / framboesa (primária)
      wineDark:  '158 28 68',   // framboesa escura (hover / texto forte)
      blush:     '240 182 208', // rosa claro (bordas / realces)
      blushSoft: '250 225 238', // rosa muito suave (trilho / fundos)
      clay:      '172 115 142', // rosa-acinzentado (texto secundário)
      gold:      '215 162 55',  // dourado (detalhe)
      card:      '255 255 255', // cartão branco
    },
    fontes: { display: "'Playfair Display', serif", body: "'Lato', sans-serif" },
    fonteUrl: 'https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;500;600&family=Lato:wght@300;400;700&display=swap',
    rotulos: {
      stepProfissional:  'Cabeleireiro',
      tituloProfissional:'Escolha o cabeleireiro',
      subProfissional:   'Quem vai cuidar do seu cabelo?',
      subServico:        'Selecione o serviço desejado.',
      labelProfissional: 'Cabeleireiro',
    },
  },

  // ── tema_5 — Beauty Studio ───────────────────────────────────────────────────
  tema_5: {
    cores: {
      ivory:     '252 247 240', // bege claro quente
      wine:      '148 102 62',  // caramelo / terracota (primária)
      wineDark:  '108 72 35',   // marrom escuro (hover / texto forte)
      blush:     '225 200 170', // nude claro (bordas / realces)
      blushSoft: '243 232 218', // nude muito suave (trilho / fundos)
      clay:      '178 148 115', // bege-acinzentado (texto secundário)
      gold:      '198 158 82',  // dourado (detalhe)
      card:      '255 252 247', // creme levíssimo
    },
    fontes: { display: "'Cormorant Garamond', serif", body: "'Nunito', sans-serif" },
    fonteUrl: 'https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,500;0,600;1,300&family=Nunito:wght@300;400;500;600&display=swap',
    rotulos: {
      stepProfissional:  'Designer',
      tituloProfissional:'Escolha a designer',
      subProfissional:   'Quem vai te transformar?',
      subServico:        'Selecione o serviço desejado.',
      labelProfissional: 'Designer',
    },
  },

  // ── tema_6 — Ink & Art ───────────────────────────────────────────────────────
  tema_6: {
    cores: {
      ivory:     '14 13 12',    // preto profundo quente (fundo)
      wine:      '210 45 45',   // vermelho intenso (primária)
      wineDark:  '248 90 90',   // vermelho claro (hover / texto forte — ilumina no escuro)
      blush:     '88 22 22',    // vermelho escuro (bordas / realces)
      blushSoft: '42 18 18',    // vermelho muito escuro (trilho / fundos)
      clay:      '162 130 130', // cinza-rosado (texto secundário)
      gold:      '220 182 80',  // dourado (detalhe)
      card:      '26 22 22',    // cartão quase preto
    },
    fontes: { display: "'Bebas Neue', sans-serif", body: "'Barlow', sans-serif" },
    fonteUrl: 'https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Barlow:wght@300;400;500;600&display=swap',
    rotulos: {
      stepProfissional:  'Tatuador',
      tituloProfissional:'Escolha o tatuador',
      subProfissional:   'Quem vai criar sua arte?',
      subServico:        'Selecione o serviço desejado.',
      labelProfissional: 'Tatuador',
    },
  },

  // ── tema_7 — Luxo Premium ────────────────────────────────────────────────────
  tema_7: {
    cores: {
      ivory:     '252 250 244', // branco pérola
      wine:      '172 140 82',  // champagne / dourado premium (primária)
      wineDark:  '135 108 52',  // dourado escuro (hover / texto forte)
      blush:     '228 212 180', // dourado claro (bordas / realces)
      blushSoft: '244 237 220', // quase branco dourado (trilho / fundos)
      clay:      '182 165 138', // bege-dourado (texto secundário)
      gold:      '210 175 72',  // dourado brilhante (detalhe)
      card:      '255 254 250', // branco levíssimo
    },
    fontes: { display: "'Cormorant Garamond', serif", body: "'Montserrat', sans-serif" },
    fonteUrl: 'https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,500;0,600;1,300&family=Montserrat:wght@300;400;500;600&display=swap',
    rotulos: {
      stepProfissional:  'Especialista',
      tituloProfissional:'Escolha a especialista',
      subProfissional:   'Em boas mãos.',
      subServico:        'Selecione o cuidado desejado.',
      labelProfissional: 'Especialista',
    },
  },

  // ── tema_8 — Minimalista Mono ────────────────────────────────────────────────
  tema_8: {
    cores: {
      ivory:     '250 250 250', // branco quase puro (fundo predominante)
      wine:      '24 24 27',    // preto (primária)
      wineDark:  '0 0 0',       // preto puro (hover / texto forte)
      blush:     '212 212 216', // cinza claro (bordas / realces)
      blushSoft: '235 235 238', // cinza muito claro (trilho / fundos)
      clay:      '113 113 122', // cinza médio (texto secundário)
      gold:      '161 161 170', // cinza (detalhe — no lugar do dourado)
      card:      '255 255 255', // cartão branco puro
    },
    fontes: { display: "'Space Grotesk', sans-serif", body: "'Inter', sans-serif" },
    fonteUrl: 'https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=Inter:wght@300;400;500;600&display=swap',
    rotulos: {
      stepProfissional:  'Profissional',
      tituloProfissional:'Escolha o profissional',
      subProfissional:   'Quem vai te atender?',
      subServico:        'Selecione o serviço desejado.',
      labelProfissional: 'Profissional',
    },
  },

};

// Perfis de profissional — independentes do tema visual.
// Definem os textos/rótulos exibidos no frontend (etapas, títulos, subtítulos).
// Escolhidos pelo .env: PERFIL_PROFISSIONAL=barbeiro
// Sem PERFIL_PROFISSIONAL definido, o server cai no tema.rotulos como fallback.
const PERFIS = {

  profissional: {
    stepProfissional:   'Profissional',
    tituloProfissional: 'Escolha a profissional',
    subProfissional:    'Quem cuidará de você hoje?',
    subServico:         'Selecione o cuidado desejado.',
    labelProfissional:  'Profissional',
  },

  barbeiro: {
    stepProfissional:   'Barbeiro',
    tituloProfissional: 'Escolha o barbeiro',
    subProfissional:    'Quem vai te atender hoje?',
    subServico:         'Selecione o serviço desejado.',
    labelProfissional:  'Barbeiro',
  },

  terapeuta: {
    stepProfissional:   'Terapeuta',
    tituloProfissional: 'Escolha a terapeuta',
    subProfissional:    'Quem cuida de você hoje?',
    subServico:         'Selecione o tratamento desejado.',
    labelProfissional:  'Terapeuta',
  },

  cabeleireiro: {
    stepProfissional:   'Cabeleireiro',
    tituloProfissional: 'Escolha o cabeleireiro',
    subProfissional:    'Quem vai cuidar do seu cabelo?',
    subServico:         'Selecione o serviço desejado.',
    labelProfissional:  'Cabeleireiro',
  },

  designer: {
    stepProfissional:   'Designer',
    tituloProfissional: 'Escolha a designer',
    subProfissional:    'Quem vai te transformar?',
    subServico:         'Selecione o serviço desejado.',
    labelProfissional:  'Designer',
  },

  tatuador: {
    stepProfissional:   'Tatuador',
    tituloProfissional: 'Escolha o tatuador',
    subProfissional:    'Quem vai criar sua arte?',
    subServico:         'Selecione o serviço desejado.',
    labelProfissional:  'Tatuador',
  },

  especialista: {
    stepProfissional:   'Especialista',
    tituloProfissional: 'Escolha a especialista',
    subProfissional:    'Em boas mãos.',
    subServico:         'Selecione o cuidado desejado.',
    labelProfissional:  'Especialista',
  },

};

// Monta o bloco CSS com as variáveis do tema (cores + fontes) p/ injetar no <head>.
function cssVars(tema) {
  const c = tema.cores;
  const vars = [
    `--c-ivory:${c.ivory}`, `--c-wine:${c.wine}`, `--c-wineDark:${c.wineDark}`,
    `--c-blush:${c.blush}`, `--c-blushSoft:${c.blushSoft}`, `--c-clay:${c.clay}`,
    `--c-gold:${c.gold}`, `--c-card:${c.card}`,
    `--f-display:${tema.fontes.display}`, `--f-body:${tema.fontes.body}`,
  ];
  return vars.join(';');
}

module.exports = { TEMAS, PERFIS, cssVars };
