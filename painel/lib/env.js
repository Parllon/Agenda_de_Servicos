// env.js — ler e atualizar um arquivo .env SEM destruir os comentários.
// O .env do _template tem comentários úteis (e comentários inline na mesma linha).
// Em vez de regravar do zero, fazemos parse linha-a-linha e só trocamos o VALOR das
// chaves pedidas — mesma ideia do `sed` no novo-cliente.sh, mas preservando o "# ...".

// Lê o conteúdo e devolve um objeto { CHAVE: valor } (ignora comentários/linhas vazias).
function parseEnv(texto) {
  const out = {};
  for (const linha of texto.split(/\r?\n/)) {
    const limpa = linha.trim();
    if (!limpa || limpa.startsWith('#')) continue;
    const igual = linha.indexOf('=');
    if (igual === -1) continue;
    const chave = linha.slice(0, igual).trim();
    let valor = linha.slice(igual + 1);
    // remove comentário inline (ex.: "8090   # porta") e espaços nas pontas
    valor = valor.replace(/\s+#.*$/, '').trim();
    out[chave] = valor;
  }
  return out;
}

// Recebe o texto original e um objeto { CHAVE: novoValor } e devolve o texto novo,
// trocando só o valor dessas chaves e mantendo o resto (comentários inclusive) intacto.
function updateEnv(texto, updates) {
  const chaves = Object.keys(updates);
  const linhas = texto.split(/\r?\n/);
  const usadas = new Set();

  const novas = linhas.map((linha) => {
    const igual = linha.indexOf('=');
    if (igual === -1 || linha.trim().startsWith('#')) return linha;
    const chave = linha.slice(0, igual).trim();
    if (!chaves.includes(chave)) return linha;
    usadas.add(chave);
    // preserva um eventual comentário inline depois do valor
    const resto = linha.slice(igual + 1);
    const comentario = resto.match(/(\s+#.*)$/);
    const sufixo = comentario ? comentario[1] : '';
    return `${chave}=${updates[chave]}${sufixo}`;
  });

  // chaves que não existiam no arquivo são acrescentadas no fim
  for (const chave of chaves) {
    if (!usadas.has(chave)) novas.push(`${chave}=${updates[chave]}`);
  }
  return novas.join('\n');
}

module.exports = { parseEnv, updateEnv };
