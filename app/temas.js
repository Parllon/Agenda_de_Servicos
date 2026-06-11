// temas.js — presets visuais reutilizáveis.
// O MESMO código serve a vários nichos; só o tema muda. Escolha pelo .env: TEMA=barbearia
//
// As cores são canais RGB ("R G B", sem vírgula) de propósito: assim o Tailwind
// consegue aplicar transparência (ex.: bg-blush/40) usando rgb(var(--c-blush) / .4).
// Mude SÓ os valores aqui — as classes no HTML/JS não precisam ser tocadas.

const TEMAS = {
  // Tema original (Bya) — claro, feminino.
  manicure: {
    cores: {
      ivory:     '251 246 240', // fundo da página
      wine:      '92 35 48',    // cor primária (botões, destaques, progresso)
      wineDark:  '65 24 37',    // texto forte / hover de botão
      blush:     '230 185 188', // bordas e realces suaves
      blushSoft: '243 222 223', // trilho do progresso / fundos muito suaves
      clay:      '201 138 142', // texto secundário
      gold:      '185 138 75',  // detalhe (linha do cabeçalho)
      card:      '255 255 255', // fundo dos cartões
    },
    fontes: { display: "'Fraunces', serif", body: "'Jost', sans-serif" },
    fonteUrl: 'https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,300..600&family=Jost:wght@300;400;500;600&display=swap',
    rotulos: {
      stepProfissional: 'Profissional',
      tituloProfissional: 'Escolha a profissional',
      subProfissional: 'Quem cuidará de você hoje?',
      subServico: 'Selecione o cuidado desejado.',
      labelProfissional: 'Profissional', // usado no resumo (app.js)
    },
  },

  // Tema barbearia — escuro, preto + dourado, tipografia forte.
  barbearia: {
    cores: {
      ivory:     '18 17 16',    // fundo quase preto (quente)
      wine:      '198 160 74',  // dourado (primária)
      wineDark:  '226 197 122', // dourado claro (texto forte / hover — "ilumina")
      blush:     '92 78 44',    // dourado escuro p/ bordas e realces sutis
      blushSoft: '46 42 32',    // trilho do progresso
      clay:      '160 150 128', // bege acinzentado (texto secundário)
      gold:      '198 160 74',  // detalhe dourado
      card:      '30 28 24',    // cartões cinza-escuro
    },
    fontes: { display: "'Oswald', sans-serif", body: "'Barlow', sans-serif" },
    fonteUrl: 'https://fonts.googleapis.com/css2?family=Oswald:wght@300;400;500;600&family=Barlow:wght@300;400;500;600&display=swap',
    rotulos: {
      stepProfissional: 'Barbeiro',
      tituloProfissional: 'Escolha o barbeiro',
      subProfissional: 'Quem vai te atender hoje?',
      subServico: 'Selecione o serviço desejado.',
      labelProfissional: 'Barbeiro',
    },
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

module.exports = { TEMAS, cssVars };
