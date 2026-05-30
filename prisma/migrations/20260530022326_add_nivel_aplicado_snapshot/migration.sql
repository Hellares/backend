-- Snapshot del nivel/precio aplicado por linea de venta (trazabilidad)
ALTER TABLE "VentaDetalle" ADD COLUMN "nivelAplicadoSnapshot" TEXT;
