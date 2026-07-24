-- PIN de entrega (prueba de entrega): generado al salir EN_CAMINO, lo
-- recibe SOLO el cliente; el repartidor debe ingresarlo para ENTREGADO.
ALTER TABLE "delivery_local" ADD COLUMN "pinEntrega" TEXT;
