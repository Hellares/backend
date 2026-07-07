-- Texto de pie de página POR TIPO en ConfiguracionDocumentos: la empresa
-- define un texto para tickets de VENTA (ej. "no se aceptan devoluciones")
-- y otro para tickets/documentos de SERVICIO (términos); null = usa el
-- textoPiePagina global. Aditiva.

-- AlterTable
ALTER TABLE "ConfiguracionDocumentos" ADD COLUMN "textoPieVenta" TEXT;
ALTER TABLE "ConfiguracionDocumentos" ADD COLUMN "textoPieServicio" TEXT;
