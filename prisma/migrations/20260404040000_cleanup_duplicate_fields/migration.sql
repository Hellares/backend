-- Limpieza: eliminar campos duplicados que ahora se leen de Empresa/Sede/ConfigDocumentos

-- ConfiguracionFacturacion: datos fiscales ahora en Empresa, marca en ConfigDocumentos
ALTER TABLE "ConfiguracionFacturacion" DROP COLUMN IF EXISTS "ruc";
ALTER TABLE "ConfiguracionFacturacion" DROP COLUMN IF EXISTS "razonSocial";
ALTER TABLE "ConfiguracionFacturacion" DROP COLUMN IF EXISTS "nombreComercial";
ALTER TABLE "ConfiguracionFacturacion" DROP COLUMN IF EXISTS "direccionFiscal";
ALTER TABLE "ConfiguracionFacturacion" DROP COLUMN IF EXISTS "telefono";
ALTER TABLE "ConfiguracionFacturacion" DROP COLUMN IF EXISTS "logoEmpresa";

-- ConfiguracionDocumentos: datos fiscales ahora se leen dinámicamente de Empresa/Sede
ALTER TABLE "ConfiguracionDocumentos" DROP COLUMN IF EXISTS "ruc";
ALTER TABLE "ConfiguracionDocumentos" DROP COLUMN IF EXISTS "direccion";
ALTER TABLE "ConfiguracionDocumentos" DROP COLUMN IF EXISTS "telefono";
ALTER TABLE "ConfiguracionDocumentos" DROP COLUMN IF EXISTS "email";
