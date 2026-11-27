// pendentes.js — horários que uma resposta "2"/"3" do WhatsApp poderia cancelar.

// "Pendente" = confirmado e ainda não terminou: horários passados continuam
// 'confirmado' no banco. Usa `fim` para o cliente atrasado ainda alcançar o horário
// em andamento. datetime() normaliza o fuso ("Z" ou "-03:00").
function listarPendentes(db, telefone) {
  return db
    .prepare(
      `SELECT * FROM agendamentos
       WHERE cliente_telefone = ? AND status = 'confirmado'
         AND datetime(fim) > datetime('now')
       ORDER BY datetime(inicio) ASC`
    )
    .all(telefone);
}

// Mensagem enviada quando há mais de um pendente e não dá para saber qual cancelar.
// itens: [{ salao, contato, inicio, servico }], já na ordem de exibição.
function montarAvisoAmbiguo(itens, tz) {
  const linhas = itens.map((i) => {
    const quando = new Date(i.inicio);
    const data = quando.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', timeZone: tz });
    const hora = quando.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: tz });
    const contato = i.contato ? `\n  Falar com o salão: ${i.contato}` : '';
    return `• ${i.salao} — ${data} às ${hora} (${i.servico})${contato}`;
  });
  return [
    'Você tem mais de um horário marcado, então não cancelei nenhum:',
    ...linhas,
    'Para cancelar ou reagendar, fale com o salão.',
  ].join('\n');
}

module.exports = { listarPendentes, montarAvisoAmbiguo };
