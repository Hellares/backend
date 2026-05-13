-- Agrega `aliasTicket` a Usuario para que el ticket de venta/cotización/orden
-- de servicio muestre un nombre corto (ej: "JP", "Caja 1") en lugar del
-- nombre completo de la persona. Opt-in: si es null, el ticket sigue
-- imprimiendo el nombre completo como hasta ahora.
ALTER TABLE "Usuario" ADD COLUMN IF NOT EXISTS "aliasTicket" TEXT;
