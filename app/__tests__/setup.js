// setup.js — variáveis de ambiente carregadas antes de qualquer módulo nos testes.
// Referenciado em jest.config.js (setupFiles). Roda uma vez por worker Jest.

process.env.NODE_ENV = 'test';

// Banco em memória: cada worker inicia com DB zerado, sem tocar no volume de produção.
process.env.DB_PATH = ':memory:';

// Fuso
process.env.TIMEZONE = 'America/Sao_Paulo';
process.env.TIMEZONE_OFFSET = '-03:00';

// Expediente e regras de agendamento
process.env.EXPEDIENTE_INICIO = '9';
process.env.EXPEDIENTE_FIM = '18';
process.env.SLOT_STEP_MIN = '30';
process.env.ANTECEDENCIA_AGENDAMENTO_MIN = '0'; // desliga a regra nos testes
process.env.JANELA_DIAS = '60';
process.env.FOLGAS = '';

// Visual / identidade
process.env.TEMA = 'tema_1';
process.env.PERFIL_PROFISSIONAL = 'profissional';

// Rede
process.env.CORS_ORIGIN = '';
process.env.LANDING_URL = 'https://test.example.com';
process.env.PORT = '0'; // porta aleatória (supertest não precisa de listen)

// WhatsApp
process.env.WHATSAPP_MODE = 'proprio';
process.env.WHATSAPP_PROVIDER = 'evolution';
process.env.WHATSAPP_API_URL = 'http://localhost:9999'; // inválido — deve ser mockado
process.env.WHATSAPP_API_TOKEN = 'test-token';
process.env.WHATSAPP_INSTANCE = 'test-instance';

// Google Calendar — google.js é mockado nos testes de API; este caminho nunca é lido.
process.env.GOOGLE_CREDENTIALS_PATH = '/dev/null';
