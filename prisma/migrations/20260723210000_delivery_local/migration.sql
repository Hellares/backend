-- DELIVERY LOCAL F1 (aditiva, sin datos): repartidores propios de la
-- empresa. El producto se paga completo ANTES (venta PAGADA_COMPLETA);
-- el repartidor cobra solo su tarifa al entregar.

-- Rol nuevo (aditivo; no se usa dentro de esta misma transacción)
ALTER TYPE "Rol" ADD VALUE IF NOT EXISTS 'REPARTIDOR';

-- Estado del delivery local
CREATE TYPE "EstadoDeliveryLocal" AS ENUM ('SOLICITADO', 'TOMADO', 'EN_CAMINO', 'ENTREGADO', 'CANCELADO');

-- Tarifa default del delivery por sede
ALTER TABLE "Sede" ADD COLUMN "tarifaDeliveryLocal" DECIMAL(10,2);

-- Tabla del delivery local
CREATE TABLE "delivery_local" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "sedeId" TEXT NOT NULL,
    "ventaId" TEXT,
    "pedidoMarketplaceId" TEXT,
    "estado" "EstadoDeliveryLocal" NOT NULL DEFAULT 'SOLICITADO',
    "destinatarioNombre" TEXT NOT NULL,
    "destinatarioCelular" TEXT,
    "direccion" TEXT NOT NULL,
    "referencia" TEXT,
    "distrito" TEXT,
    "coordenadas" JSONB,
    "costoDelivery" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "repartidorId" TEXT,
    "tomadoEn" TIMESTAMP(3),
    "enCaminoEn" TIMESTAMP(3),
    "entregadoEn" TIMESTAMP(3),
    "canceladoEn" TIMESTAMP(3),
    "motivoCancelacion" TEXT,
    "trackingToken" TEXT NOT NULL,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "delivery_local_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "delivery_local_ventaId_key" ON "delivery_local"("ventaId");
CREATE UNIQUE INDEX "delivery_local_pedidoMarketplaceId_key" ON "delivery_local"("pedidoMarketplaceId");
CREATE UNIQUE INDEX "delivery_local_trackingToken_key" ON "delivery_local"("trackingToken");
CREATE INDEX "delivery_local_empresaId_estado_idx" ON "delivery_local"("empresaId", "estado");
CREATE INDEX "delivery_local_sedeId_estado_idx" ON "delivery_local"("sedeId", "estado");
CREATE INDEX "delivery_local_repartidorId_estado_idx" ON "delivery_local"("repartidorId", "estado");

ALTER TABLE "delivery_local" ADD CONSTRAINT "delivery_local_ventaId_fkey" FOREIGN KEY ("ventaId") REFERENCES "Venta"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "delivery_local" ADD CONSTRAINT "delivery_local_repartidorId_fkey" FOREIGN KEY ("repartidorId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;
