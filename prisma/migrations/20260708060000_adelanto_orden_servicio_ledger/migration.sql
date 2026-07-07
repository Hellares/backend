-- LIBRO de adelantos por orden de servicio: cada abono es una fila con
-- fecha/hora, método y usuario. Motiva el cambio: el campo único editable
-- "adelanto" hacía que registrar un 2º abono (50 + 10) se interpretara como
-- corrección del total (50 -> 10) devolviendo dinero en caja. Aditiva +
-- backfill: el adelanto acumulado existente se convierte en la 1ª fila.

-- CreateTable
CREATE TABLE "AdelantoOrdenServicio" (
    "id" TEXT NOT NULL,
    "ordenServicioId" TEXT NOT NULL,
    "monto" DECIMAL(10,2) NOT NULL,
    "metodoPago" TEXT NOT NULL DEFAULT 'EFECTIVO',
    "nota" TEXT,
    "creadoPor" TEXT,
    "creadoPorNombre" TEXT,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "anulado" BOOLEAN NOT NULL DEFAULT false,
    "anuladoEn" TIMESTAMP(3),
    "anuladoPor" TEXT,

    CONSTRAINT "AdelantoOrdenServicio_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AdelantoOrdenServicio_ordenServicioId_idx" ON "AdelantoOrdenServicio"("ordenServicioId");

-- AddForeignKey
ALTER TABLE "AdelantoOrdenServicio" ADD CONSTRAINT "AdelantoOrdenServicio_ordenServicioId_fkey" FOREIGN KEY ("ordenServicioId") REFERENCES "OrdenServicio"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: órdenes con adelanto acumulado > 0 quedan con su fila inicial
-- (fecha = creación de la orden: es lo más cercano que se conoce).
INSERT INTO "AdelantoOrdenServicio" ("id", "ordenServicioId", "monto", "metodoPago", "nota", "creadoEn")
SELECT
    'adel_' || substr(md5(random()::text || o.id), 1, 20),
    o.id,
    o.adelanto,
    COALESCE(o."metodoPagoAdelanto", 'EFECTIVO'),
    'Adelanto acumulado previo (migrado)',
    o."creadoEn"
FROM "OrdenServicio" o
WHERE o.adelanto IS NOT NULL AND o.adelanto > 0;
