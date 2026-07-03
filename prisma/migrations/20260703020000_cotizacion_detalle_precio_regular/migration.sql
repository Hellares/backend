-- Precio unitario REGULAR (antes del nivel por mayor / precio VIP) en el
-- detalle de cotización. Permite mostrarle al cliente el ahorro completo
-- (nivel + descuento manual). Aditiva: nullable, sin backfill.
ALTER TABLE "CotizacionDetalle" ADD COLUMN "precioRegular" DECIMAL(14,4);
