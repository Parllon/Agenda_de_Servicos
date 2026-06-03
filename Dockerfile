# Use Node 22 LTS (debian slim) — better-sqlite3 tem binário pré-compilado p/ glibc.
# Não use a variante "alpine": musl forçaria compilação nativa.
FROM node:22-slim

WORKDIR /app

# Instala dependências primeiro (melhor cache)
COPY package*.json ./
RUN npm install --omit=dev

# Copia o restante do código
COPY . .

EXPOSE 3000

CMD ["node", "server.js"]
