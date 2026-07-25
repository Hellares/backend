-- Delivery INTERNO: lo lleva un empleado (no se publica al pool de
-- repartidores; el staff avanza los estados sin PIN).
-- OJO: el modelo DeliveryLocal está @@map("delivery_local").
ALTER TABLE "delivery_local" ADD COLUMN "esInterno" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "delivery_local" ADD COLUMN "encargadoInterno" TEXT;
