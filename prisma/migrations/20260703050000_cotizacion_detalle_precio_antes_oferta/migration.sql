-- Precio NORMAL de sede antes de la OFERTA/liquidación pública vigente al
-- cotizar. Informativo (chip "En oferta — antes S/X" en el detalle): la
-- oferta es precio público y NO cuenta como descuento. Aditiva, sin backfill.
ALTER TABLE "CotizacionDetalle" ADD COLUMN "precioAntesOferta" DECIMAL(14,4);
