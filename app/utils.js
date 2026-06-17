// utils.js — funções puras (sem I/O, sem process.env) exportadas para testes unitários.

const hh = (n) => String(n).padStart(2, '0');

/**
 * Gera os slots disponíveis de um dia.
 * Recebe toda a configuração como parâmetro — sem ler process.env — para ser testável.
 *
 * @param {string} dataISO        "YYYY-MM-DD"
 * @param {number} duracao        duração do serviço em minutos
 * @param {Array}  ocupados       [{start, end}] (ISO strings) do freebusy do Google
 * @param {Date}   agora          instante atual (Date)
 * @param {object} cfg
 * @param {number} cfg.inicioHora hora de início do expediente (ex: 9)
 * @param {number} cfg.fimHora    hora de fim do expediente (ex: 18)
 * @param {number} cfg.slotStep   intervalo entre inícios de slots em minutos (ex: 30)
 * @param {number} cfg.antecedenciaMin antecedência mínima em minutos
 * @param {string} cfg.offset     offset do fuso, ex: "-03:00"
 * @param {string} cfg.tz         nome do timezone, ex: "America/Sao_Paulo"
 */
function gerarSlotsDoDia(dataISO, duracao, ocupados, agora, cfg) {
  const { inicioHora, fimHora, slotStep, antecedenciaMin, offset, tz } = cfg;
  const slots = [];
  const minInicio = new Date(agora.getTime() + antecedenciaMin * 60000);
  const cursor = new Date(`${dataISO}T${hh(inicioHora)}:00:00${offset}`);
  const limite = new Date(`${dataISO}T${hh(fimHora)}:00:00${offset}`);

  while (cursor < limite) {
    const slotInicio = new Date(cursor);
    const slotFim = new Date(cursor.getTime() + duracao * 60000);
    if (slotFim <= limite) {
      const colide = ocupados.some(
        (b) => slotInicio < new Date(b.end) && slotFim > new Date(b.start)
      );
      if (!colide && slotInicio >= minInicio) {
        slots.push({
          inicio: slotInicio.toISOString(),
          fim: slotFim.toISOString(),
          label: slotInicio.toLocaleTimeString('pt-BR', {
            hour: '2-digit',
            minute: '2-digit',
            timeZone: tz,
          }),
        });
      }
    }
    cursor.setMinutes(cursor.getMinutes() + slotStep);
  }
  return slots;
}

module.exports = { gerarSlotsDoDia, hh };
