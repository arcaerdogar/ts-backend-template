# syntax=docker/dockerfile:1

# ---- Builder: derle + prisma client üret ------------------------------------
FROM node:20-alpine AS builder

WORKDIR /app

# Önce sadece manifest'ler -> lockfile değişmedikçe bu katman cache'lenir.
COPY package.json package-lock.json ./
# npm ci: lockfile'a birebir sadık, tekrarlanabilir (reproducible) kurulum.
RUN npm ci

COPY . .

RUN npx prisma generate
RUN npm run build

# ---- Runtime: yalnızca prod bağımlılıkları + derlenmiş çıktı ----------------
FROM node:20-alpine

WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
# Sadece production bağımlılıkları (prisma CLI dependencies'te olduğu için
# migrate deploy runtime'da çalışabilir).
RUN npm ci --omit=dev

# Prisma'nın üretilmiş client'ı + query engine binary'si (builder'da generate
# edildi; aynı platform node:20-alpine olduğu için engine uyumlu).
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma

# Derlenmiş uygulama.
COPY --from=builder /app/dist ./dist

# migrate deploy için schema + migration'lar (DOĞRU hedef: ./prisma).
COPY prisma ./prisma

# Güvenlik: root yerine imajda hazır gelen ayrıcalıksız "node" (UID 1000)
# kullanıcısıyla çalış (least-privilege).
USER node

# Uygulama PORT (varsayılan 3000) dinler; compose bunu host'a map eder.
EXPOSE 3000

# Konteyner ayağa kalkarken önce bekleyen migration'ları uygula, sonra başlat.
# migrate deploy idempotent'tir: uygulanacak migration yoksa no-op.
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/index.js"]
