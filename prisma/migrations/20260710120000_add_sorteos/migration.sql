-- Sorteos F1/F2: registro de ganadores de sorteos por redes sociales con
-- premio (vínculo a inventario opcional) y envío trackeable.

-- Nuevos valores en enums existentes (aditivo)
ALTER TYPE "EntidadTipo" ADD VALUE 'SORTEO_PREMIO';
ALTER TYPE "TipoMovimientoStock" ADD VALUE 'SALIDA_SORTEO';
ALTER TYPE "TipoMovimientoStock" ADD VALUE 'ENTRADA_SORTEO_ANULADO';
ALTER TYPE "TipoNotificacion" ADD VALUE 'SORTEO';

-- Enums nuevos
CREATE TYPE "EstadoSorteo" AS ENUM ('ABIERTO', 'CERRADO');
CREATE TYPE "CanalSorteo" AS ENUM ('FACEBOOK', 'INSTAGRAM', 'TIKTOK', 'WHATSAPP', 'OTRO');
CREATE TYPE "EstadoPremioSorteo" AS ENUM ('REGISTRADO', 'PREPARANDO', 'ENVIADO', 'ENTREGADO', 'ANULADO');
CREATE TYPE "ModalidadEntregaPremio" AS ENUM ('ENVIO_AGENCIA', 'RETIRO_TIENDA');

-- Tabla Sorteo
CREATE TABLE "Sorteo" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "sedeId" TEXT,
    "titulo" TEXT NOT NULL,
    "descripcion" TEXT,
    "canal" "CanalSorteo" NOT NULL DEFAULT 'OTRO',
    "fechaSorteo" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "estado" "EstadoSorteo" NOT NULL DEFAULT 'ABIERTO',
    "creadoPorId" TEXT NOT NULL,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Sorteo_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Sorteo_empresaId_estado_idx" ON "Sorteo"("empresaId", "estado");
CREATE INDEX "Sorteo_empresaId_fechaSorteo_idx" ON "Sorteo"("empresaId", "fechaSorteo");

ALTER TABLE "Sorteo" ADD CONSTRAINT "Sorteo_empresaId_fkey"
    FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Tabla SorteoPremio
CREATE TABLE "SorteoPremio" (
    "id" TEXT NOT NULL,
    "sorteoId" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "ganadorId" TEXT NOT NULL,
    "ganadorDni" TEXT,
    "ganadorNombre" TEXT NOT NULL,
    "ganadorCelular" TEXT,
    "descripcion" TEXT NOT NULL,
    "productoId" TEXT,
    "varianteId" TEXT,
    "cantidad" INTEGER NOT NULL DEFAULT 1,
    "movimientoStockId" TEXT,
    "modalidad" "ModalidadEntregaPremio" NOT NULL DEFAULT 'RETIRO_TIENDA',
    "agenciaNombre" TEXT,
    "agenciaSede" TEXT,
    "estado" "EstadoPremioSorteo" NOT NULL DEFAULT 'REGISTRADO',
    "enviadoEn" TIMESTAMP(3),
    "entregadoEn" TIMESTAMP(3),
    "observaciones" TEXT,
    "registradoPorId" TEXT NOT NULL,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SorteoPremio_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SorteoPremio_empresaId_estado_idx" ON "SorteoPremio"("empresaId", "estado");
CREATE INDEX "SorteoPremio_ganadorId_idx" ON "SorteoPremio"("ganadorId");
CREATE INDEX "SorteoPremio_sorteoId_idx" ON "SorteoPremio"("sorteoId");

ALTER TABLE "SorteoPremio" ADD CONSTRAINT "SorteoPremio_sorteoId_fkey"
    FOREIGN KEY ("sorteoId") REFERENCES "Sorteo"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SorteoPremio" ADD CONSTRAINT "SorteoPremio_ganadorId_fkey"
    FOREIGN KEY ("ganadorId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
