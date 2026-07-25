-- Delivery INTERNO: lo lleva un empleado (no se publica al pool de
-- repartidores; el staff avanza los estados sin PIN).
ALTER TABLE "DeliveryLocal" ADD COLUMN "esInterno" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "DeliveryLocal" ADD COLUMN "encargadoInterno" TEXT;
