# ===========================================
# 🐳 DOCKERFILE - NESTJS BACKEND
# ===========================================

# ------------------------------------
# Stage 1: Builder
# ------------------------------------
FROM node:20-alpine AS builder

# Instalar dependencias del sistema necesarias para Prisma y módulos nativos
RUN apk add --no-cache \
    openssl \
    libc6-compat \
    python3 \
    make \
    g++ \
    postgresql-dev

# Establecer directorio de trabajo
WORKDIR /app

# Copiar archivos de dependencias
COPY package*.json ./
COPY prisma ./prisma/
COPY prisma.config.ts ./

# Instalar TODAS las dependencias (necesarias para el build)
# Usar npm ci para instalación más confiable en Docker
RUN npm ci --verbose || npm install --verbose

# Copiar código fuente
COPY . .

# Generar Prisma Client (con URL dummy para build)
RUN DATABASE_URL="postgresql://dummy:dummy@localhost:5432/dummy" npx prisma generate

# Build de la aplicación
RUN npm run build

# Eliminar dependencias de desarrollo después del build
RUN npm prune --production

# ------------------------------------
# Stage 2: Production
# ------------------------------------
FROM node:20-alpine AS production

# Instalar dependencias del sistema y librerías de PostgreSQL.
# fontconfig + ttf-dejavu: sharp rasteriza SVG con TEXTO (cartillas de
# bingo como imagen) — sin fuentes el texto sale en blanco.
RUN apk add --no-cache \
    openssl \
    libc6-compat \
    wget \
    postgresql-libs \
    fontconfig \
    ttf-dejavu

# Crear usuario no-root para seguridad
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nestjs -u 1001

# Establecer directorio de trabajo
WORKDIR /app

# Copiar dependencias de node_modules desde builder
COPY --from=builder --chown=nestjs:nodejs /app/node_modules ./node_modules

# Copiar Prisma Client generado y configuración
COPY --from=builder --chown=nestjs:nodejs /app/prisma ./prisma
COPY --from=builder --chown=nestjs:nodejs /app/prisma.config.ts ./

# tsconfig necesario para que ts-node ejecute los seeds en runtime
COPY --from=builder --chown=nestjs:nodejs /app/tsconfig.json ./

# Copiar build de la aplicación
COPY --from=builder --chown=nestjs:nodejs /app/dist ./dist

# Copiar package.json
COPY --chown=nestjs:nodejs package*.json ./

# Crear directorio de logs con permisos
RUN mkdir -p /app/logs && \
    chown -R nestjs:nodejs /app/logs

# Cambiar a usuario no-root
USER nestjs

# Exponer puerto
EXPOSE 6000

# Comando de inicio
CMD ["node", "dist/src/main.js"]
