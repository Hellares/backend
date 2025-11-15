# ===========================================
# 🐳 DOCKERFILE - NESTJS BACKEND
# ===========================================

# ------------------------------------
# Stage 1: Builder
# ------------------------------------
FROM node:20-alpine AS builder

# Instalar dependencias del sistema necesarias para Prisma
RUN apk add --no-cache openssl libc6-compat

# Establecer directorio de trabajo
WORKDIR /app

# Copiar archivos de dependencias
COPY package*.json ./
COPY prisma ./prisma/

# Instalar dependencias
RUN npm ci --only=production && \
    npm cache clean --force

# Copiar código fuente
COPY . .

# Generar Prisma Client
RUN npx prisma generate

# Build de la aplicación
RUN npm run build

# ------------------------------------
# Stage 2: Production
# ------------------------------------
FROM node:20-alpine AS production

# Instalar dependencias del sistema
RUN apk add --no-cache openssl libc6-compat

# Crear usuario no-root para seguridad
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nestjs -u 1001

# Establecer directorio de trabajo
WORKDIR /app

# Copiar dependencias de node_modules desde builder
COPY --from=builder --chown=nestjs:nodejs /app/node_modules ./node_modules

# Copiar Prisma Client generado
COPY --from=builder --chown=nestjs:nodejs /app/prisma ./prisma

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
EXPOSE 5000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD node -e "require('http').get('http://localhost:5000/api', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# Comando de inicio
CMD ["node", "dist/main.js"]
