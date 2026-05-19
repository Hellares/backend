-- Flag a nivel de Compra: precios YA incluyen IGV (default true).
-- Convención común en Perú: el proveedor factura con precio total que
-- incluye el 18%. El service extrae el IGV del precio ingresado para
-- mantener subtotal = base imponible (sin IGV) según estándar SUNAT.

ALTER TABLE "Compra"
  ADD COLUMN "precioIncluyeIgv" BOOLEAN NOT NULL DEFAULT true;
