FROM node:20-alpine AS deps
WORKDIR /app
RUN apk add --no-cache python3 make g++
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev || npm install --omit=dev

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV DATA_DIR=/app/data
COPY --from=deps /app/node_modules ./node_modules
COPY package.json server.js ./
COPY shared ./shared
COPY server ./server
COPY public ./public
COPY scripts ./scripts

RUN addgroup -S app && adduser -S app -G app && \
    mkdir -p /app/data /app/data/backups && chown -R app:app /app
USER app

VOLUME ["/app/data"]
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/healthz || exit 1
CMD ["node", "server.js"]
