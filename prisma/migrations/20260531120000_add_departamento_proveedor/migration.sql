-- Agrega `departamento` al Proveedor (dirección). Nullable; los proveedores
-- existentes quedan con NULL. La búsqueda SUNAT/RENIEC ahora puede separar
-- departamento de provincia en lugar de concatenarlos.

ALTER TABLE "Proveedor" ADD COLUMN "departamento" TEXT;
