-- Cortina del marketplace: el super admin la activa desde syncronize-admin
-- y tapa toda la sección de productos del marketplace con un mensaje.
ALTER TABLE "ConfiguracionSistema" ADD COLUMN "marketplaceCortinaActiva" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ConfiguracionSistema" ADD COLUMN "marketplaceCortinaTitulo" TEXT DEFAULT 'Marketplace en mantenimiento';
ALTER TABLE "ConfiguracionSistema" ADD COLUMN "marketplaceCortinaMensaje" TEXT DEFAULT 'Estamos preparando novedades. Vuelve pronto.';
