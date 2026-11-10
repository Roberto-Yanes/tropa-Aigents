# Construir desde la raíz del repositorio: docker build -f relay/Dockerfile -t tropa-relay .
FROM node:24-alpine
WORKDIR /app
COPY --chown=node:node relay/package.json relay/package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY --chown=node:node protocol ./protocol
COPY --chown=node:node relay/server.mjs ./relay/server.mjs
ENV NODE_ENV=production PORT=8787 DATA_DIR=/data
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:8787/health >/dev/null || exit 1
CMD ["node", "relay/server.mjs"]
