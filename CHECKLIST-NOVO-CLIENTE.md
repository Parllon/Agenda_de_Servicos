# Checklist de Onboarding — Novo Cliente SlotMe

Use este arquivo para coletar todas as informações necessárias antes de configurar
um novo cliente no sistema. Preencha com os dados fornecidos pelo cliente e guarde
uma cópia para referência.

> **Legenda:**
> - 🔴 **Obrigatório** — sem isso o sistema não funciona corretamente
> - 🟡 **Obrigatório se o plano incluir** — depende do plano contratado
> - 🟢 **Opcional** — tem valor padrão; só preencher se o cliente quiser personalizar

---

## BLOCO 1 — O Negócio 🔴

| # | Pergunta | Resposta |
|---|---|---|
| 1.1 | **Nome do salão / estúdio** (aparece no topo da página e nas mensagens) | |
| 1.2 | **Subtítulo / especialidade** (ex: "Nail Designer", "Barbearia", "Spa") | |
| 1.3 | **Cidade** (aparece no rodapé da página) | |
| 1.4 | **Subdomínio desejado** (ex: `carol` → `carol.deadzone.com.br`) | |
| 1.5 | **Tema visual** — escolha um dos abaixo: | |
| 1.6 | **Perfil do profissional** — como a interface chama quem atende: | |

**Opções de perfil:**

| Código | Como aparece na interface | Ideal para |
|---|---|---|
| `profissional` | Profissional / Serviço | Uso geral (padrão) |
| `barbeiro` | Barbeiro / Serviço | Barbearias |
| `terapeuta` | Terapeuta / Tratamento | Spa, massagem, terapias |
| `cabeleireiro` | Cabeleireiro / Serviço | Salões de cabelo |
| `designer` | Designer / Serviço | Nail designer, sobrancelha |
| `tatuador` | Tatuador / Arte | Tattoo, piercing |
| `especialista` | Especialista / Procedimento | Clínica estética, skincare |

**Opções de tema:**

| Código | Visual | Fontes | Ideal para |
|---|---|---|---|
| `tema_1` | Fundo marfim + vinho | Fraunces + Jost | Manicure, Nail Designer |
| `tema_2` | Fundo preto + dourado | Oswald + Barlow | Barbearia tradicional |
| `tema_3` | Fundo branco + verde esmeralda | Cormorant Garamond + Raleway | Spa, Massagem, Estética |
| `tema_4` | Fundo branco + rosa cerise | Playfair Display + Lato | Cabeleireiro, Coloração |
| `tema_5` | Fundo bege + caramelo | Cormorant Garamond + Nunito | Lash, Sobrancelha, Micropig |
| `tema_6` | Fundo preto + vermelho | Bebas Neue + Barlow | Tatuagem, Piercing |
| `tema_7` | Fundo pérola + champagne | Cormorant Garamond + Montserrat | Salão premium, Clínica |

---

## BLOCO 2 — Profissionais e Serviços 🔴

*Repita esta tabela para cada profissional do salão.*

### Profissional 1

| # | Pergunta | Resposta |
|---|---|---|
| 2.1 | **Nome completo** | |
| 2.2 | **E-mail da conta Google** usada no Google Calendar (para compartilhar a agenda) | |

**Serviços do Profissional 1:**

| Serviço | Duração (min) | Valor (R$) |
|---|---|---|
| | | |
| | | |
| | | |

### Profissional 2 *(se houver)*

| # | Pergunta | Resposta |
|---|---|---|
| 2.1 | **Nome completo** | |
| 2.2 | **E-mail da conta Google** | |

**Serviços do Profissional 2:**

| Serviço | Duração (min) | Valor (R$) |
|---|---|---|
| | | |
| | | |

> Adicione mais blocos de profissional conforme necessário.

---

## BLOCO 3 — Google Calendar 🔴

*Esta etapa é feita pelo **próprio profissional** no Google Calendar dele.*

| # | Instrução / Pergunta | Confirmado? |
|---|---|---|
| 3.1 | O profissional **compartilhou a agenda** com `calendar-bot@agenda-de-servicos-498211.iam.gserviceaccount.com` com permissão **"Fazer alterações nos eventos"**? | ☐ Sim |
| 3.2 | **ID da agenda** do Profissional 1 *(Configurações do Calendar → "Integrar agenda" → "ID da agenda")* | |
| 3.3 | **ID da agenda** do Profissional 2 *(se houver)* | |

> ⚠️ Sem o compartilhamento correto, os horários aparecem todos livres mas o agendamento **não grava** no Calendar. É a causa mais comum de "confirmou mas não apareceu na agenda".

---

## BLOCO 4 — WhatsApp 🟡

*Obrigatório se o plano do cliente incluir confirmações e lembretes por WhatsApp.*

| # | Pergunta | Resposta |
|---|---|---|
| 4.1 | **Número do WhatsApp** a conectar — DDD + número, sem +55 (ex: `21999998888`) | |
| 4.2 | Este número já usa o WhatsApp normalmente no celular? *(deve estar ativo no app)* | ☐ Sim ☐ Não |
| 4.3 | O cliente sabe que o número ficará **conectado ao sistema** e não poderá ser desconectado sem avisar? | ☐ Ciente |

> ⚠️ Se o número já estiver em outro aparelho conectado (WhatsApp Web, outro sistema), **será desconectado de lá** ao parear aqui.

---

## BLOCO 5 — Fotos dos Profissionais 🟢

*Sem foto, o sistema exibe a inicial do nome num círculo colorido — funciona bem.*

| Profissional | Foto fornecida? | Nome do arquivo |
|---|---|---|
| | ☐ Sim ☐ Não | |
| | ☐ Sim ☐ Não | |

**Requisitos da foto:**
- Formato: JPG ou PNG
- Orientação: preferencialmente quadrada ou retrato
- Fundo claro ou neutro recomendado (fica melhor no tema claro)
- Tamanho: sem restrição, mas abaixo de 2 MB é suficiente

---

## BLOCO 6 — Telegram (avisos internos) 🟢

*Permite que o salão receba uma notificação no Telegram a cada novo agendamento,
cancelamento ou remarcação — sem precisar ficar checando o WhatsApp.*

| # | Pergunta | Resposta |
|---|---|---|
| 6.1 | O cliente quer receber avisos pelo Telegram? | ☐ Sim ☐ Não |
| 6.2 | *(se sim)* Token do bot do Telegram *(criado via @BotFather)* | |
| 6.3 | Chat ID do **salão / dona** *(recebe todos os agendamentos)* | |
| 6.4 | Chat ID do **Profissional 1** *(recebe só os seus — opcional)* | |
| 6.5 | Chat ID do **Profissional 2** *(recebe só os seus — opcional)* | |

> Como obter o Chat ID: envie `/start` para o bot e consulte `https://api.telegram.org/bot<TOKEN>/getUpdates`.

---

## BLOCO 7 — Expediente e Preferências 🟢

*Todos os campos têm padrão — preencha só o que for diferente.*

| # | Pergunta | Padrão | Resposta do cliente |
|---|---|---|---|
| 7.1 | **Horário de abertura** (hora cheia) | 9h | |
| 7.2 | **Horário de fechamento** (hora cheia) | 19h | |
| 7.3 | **Dias sem atendimento** (0=dom, 1=seg, 2=ter, 3=qua, 4=qui, 5=sex, 6=sáb) | domingo (0) | |
| 7.4 | **Intervalo mínimo entre horários** disponíveis (min) | 30 min | |
| 7.5 | **Quantos dias à frente** os clientes podem agendar | 30 dias | |
| 7.6 | **Horário do lembrete de véspera** (hora cheia) | 21h | |

---

## BLOCO 8 — Mensagens Personalizadas 🟢

*O sistema já sorteia entre 10 variações de texto por tipo. Preencha só se o
cliente quiser um texto específico diferente do padrão.*

| Tipo | O cliente quer personalizar? | Texto desejado |
|---|---|---|
| Confirmação de agendamento | ☐ Sim ☐ Não | |
| Lembrete de véspera | ☐ Sim ☐ Não | |
| Lembrete ~1h antes | ☐ Sim ☐ Não | |
| Resposta ao confirmar (opção 1) | ☐ Sim ☐ Não | |
| Resposta ao reagendar (opção 2) | ☐ Sim ☐ Não | |
| Resposta ao cancelar (opção 3) | ☐ Sim ☐ Não | |

**Marcadores disponíveis nos textos:**
`{nome}` `{servico}` `{profissional}` `{data}` `{hora}` `{link}`

---

## Resumo de prontidão

Antes de começar a configurar, confirme que tem em mãos:

- [ ] Bloco 1 completo (nome, subtítulo, cidade, subdomínio, tema, perfil)
- [ ] Bloco 2 completo para todos os profissionais (nome + serviços)
- [ ] Bloco 3: agendas Google compartilhadas e IDs coletados
- [ ] Bloco 4: número de WhatsApp confirmado *(se plano incluir)*
- [ ] Fotos recebidas e renomeadas *(se o cliente quiser)*
- [ ] Telegram configurado *(se o cliente quiser)*
- [ ] Preferências de expediente anotadas *(se diferente do padrão)*

Com tudo isso em mãos, siga o **Manual de onboarding** na seção 5 da
`DOCUMENTACAO-SLOTME.md`.
