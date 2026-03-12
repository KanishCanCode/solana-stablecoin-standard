# Multi-stage build — Node 22 Alpine
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder /app/dist          ./dist
COPY --from=builder /app/node_modules  ./node_modules
COPY --from=builder /app/package.json  ./package.json
COPY --from=builder /app/src/db/schema.prisma ./prisma/schema.prisma

EXPOSE 3001
HEALTHCHECK --interval=15s --timeout=5s CMD wget -qO- http://localhost:3001/healthz || exit 1
CMD ["node", "dist/server.js"]
