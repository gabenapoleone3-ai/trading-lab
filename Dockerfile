FROM node:24-bookworm-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends git && rm -rf /var/lib/apt/lists/*
COPY --chown=node:node package*.json ./
RUN --mount=type=secret,id=proxy_ca sh -c 'if [ -f /run/secrets/proxy_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/proxy_ca; fi; npm ci'
COPY . .
RUN npm test && npm run build
FROM node:24-bookworm-slim
ENV NODE_ENV=production PORT=8080 PAPER_STATE_PATH=/state/state.json
WORKDIR /app
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/bot ./bot
COPY --from=build --chown=node:node /app/src/engine.ts ./src/engine.ts
COPY --chown=node:node package*.json ./
RUN --mount=type=secret,id=proxy_ca sh -c 'if [ -f /run/secrets/proxy_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/proxy_ca; fi; npm ci --omit=dev'
RUN mkdir /state && chown node:node /state
USER node
EXPOSE 8080
CMD ["node", "--use-env-proxy", "bot/main.ts"]
