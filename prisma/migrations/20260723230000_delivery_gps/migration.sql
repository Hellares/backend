-- GPS en vivo del delivery local (F3): última posición del repartidor.
-- Solo se escribe mientras el delivery está EN_CAMINO.
ALTER TABLE "delivery_local" ADD COLUMN "ultimaPosicion" JSONB;
ALTER TABLE "delivery_local" ADD COLUMN "posicionEn" TIMESTAMP(3);
