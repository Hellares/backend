-- Subasta de deliveries estilo inDrive.
--
-- La empresa no puede saber cuánto sale llegar a cada zona — el que lo sabe
-- es el repartidor. En vez de decretar la tarifa, la empresa publica (con
-- precio sugerido o sin nada) y los repartidores ofertan; la empresa elige y
-- ahí recién se asigna el pedido.
--
-- Escrita a mano y NO con `prisma migrate dev`: el .env local apunta a la
-- base de PRODUCCIÓN (db_saas), así que generar migraciones desde acá es
-- peligroso. Se aplica con `deploy.sh migrate <env>`.

CREATE TYPE "EstadoOfertaDelivery" AS ENUM (
  'PENDIENTE',
  'ACEPTADA',
  'RECHAZADA',
  'RETIRADA'
);

-- `modoOferta` activo = el delivery NO se puede tomar directo, solo por
-- oferta aceptada. Si convivieran las dos vías, el primero que acepta el
-- precio base gana siempre y la subasta nunca ocurriría.
ALTER TABLE "delivery_local"
  ADD COLUMN "modoOferta" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "costoSugerido" DECIMAL(10,2);

CREATE TABLE "oferta_delivery" (
  "id"           TEXT NOT NULL,
  "deliveryId"   TEXT NOT NULL,
  "repartidorId" TEXT NOT NULL,
  "monto"        DECIMAL(10,2) NOT NULL,
  "comentario"   TEXT,
  "estado"       "EstadoOfertaDelivery" NOT NULL DEFAULT 'PENDIENTE',
  "creadoEn"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- Vencen a los 10 min: una oferta vieja no sirve porque el repartidor ya
  -- puede estar ocupado. NO hay job que las marque — el vencimiento se
  -- deriva comparando esta columna contra ahora, así que todo lo que lea
  -- PENDIENTES debe filtrar por `expiraEn > now()`.
  "expiraEn"     TIMESTAMP(3) NOT NULL,
  "resueltoEn"   TIMESTAMP(3),

  CONSTRAINT "oferta_delivery_pkey" PRIMARY KEY ("id")
);

-- Una oferta viva por repartidor y delivery: re-ofertar pisa la anterior.
CREATE UNIQUE INDEX "oferta_delivery_deliveryId_repartidorId_key"
  ON "oferta_delivery" ("deliveryId", "repartidorId");

CREATE INDEX "oferta_delivery_deliveryId_estado_idx"
  ON "oferta_delivery" ("deliveryId", "estado");

CREATE INDEX "oferta_delivery_repartidorId_estado_idx"
  ON "oferta_delivery" ("repartidorId", "estado");

ALTER TABLE "oferta_delivery"
  ADD CONSTRAINT "oferta_delivery_deliveryId_fkey"
  FOREIGN KEY ("deliveryId") REFERENCES "delivery_local"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "oferta_delivery"
  ADD CONSTRAINT "oferta_delivery_repartidorId_fkey"
  FOREIGN KEY ("repartidorId") REFERENCES "Usuario"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
