-- Datos del despacho de agencia: número de orden, código y clave de
-- recojo (visibles para el ganador en Mis Premios).

ALTER TABLE "SorteoPremio" ADD COLUMN "envioNumeroOrden" TEXT;
ALTER TABLE "SorteoPremio" ADD COLUMN "envioCodigo" TEXT;
ALTER TABLE "SorteoPremio" ADD COLUMN "envioClave" TEXT;
