-- Pedido marketplace: delivery local vs envío por agencia (como en la venta).
ALTER TABLE "PedidoMarketplace" ADD COLUMN "modalidadEnvio" TEXT;
ALTER TABLE "PedidoMarketplace" ADD COLUMN "agenciaEnvio" TEXT;
ALTER TABLE "PedidoMarketplace" ADD COLUMN "agenciaDireccionEnvio" TEXT;
