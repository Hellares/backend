-- Índices de rendimiento para tablas de alto volumen (Venta + ComprobanteElectronico)
-- Proyección: 1.2M ventas/año, 960K comprobantes/año con 500 empresas

-- ══ VENTA ══

-- Reportes y analytics por fecha
CREATE INDEX IF NOT EXISTS "Venta_empresaId_fechaVenta_idx" ON "Venta"("empresaId", "fechaVenta");
CREATE INDEX IF NOT EXISTS "Venta_empresaId_sedeId_fechaVenta_idx" ON "Venta"("empresaId", "sedeId", "fechaVenta");

-- Créditos: listado de ventas a crédito pendientes
CREATE INDEX IF NOT EXISTS "Venta_empresaId_esCredito_estado_idx" ON "Venta"("empresaId", "esCredito", "estado");

-- Canal de venta
CREATE INDEX IF NOT EXISTS "Venta_empresaId_canalVenta_fechaVenta_idx" ON "Venta"("empresaId", "canalVenta", "fechaVenta");

-- Búsqueda por documento cliente
CREATE INDEX IF NOT EXISTS "Venta_empresaId_documentoCliente_idx" ON "Venta"("empresaId", "documentoCliente");

-- ══ COMPROBANTE ELECTRÓNICO ══

-- FK ventaId (faltaba)
CREATE INDEX IF NOT EXISTS "ComprobanteElectronico_ventaId_idx" ON "ComprobanteElectronico"("ventaId");

-- Monitor: filtro por empresa + sunatStatus
CREATE INDEX IF NOT EXISTS "ComprobanteElectronico_empresaId_sunatStatus_idx" ON "ComprobanteElectronico"("empresaId", "sunatStatus");

-- Monitor: filtro por empresa + tipo + fecha
CREATE INDEX IF NOT EXISTS "ComprobanteElectronico_empresaId_tipoComprobante_fechaEmision_idx" ON "ComprobanteElectronico"("empresaId", "tipoComprobante", "fechaEmision");

-- Reenvío de pendientes: status + estado + intentos
CREATE INDEX IF NOT EXISTS "ComprobanteElectronico_sunatStatus_estado_intentosEnvio_idx" ON "ComprobanteElectronico"("sunatStatus", "estado", "intentosEnvio");

-- Reporte correlativos: empresa + serie
CREATE INDEX IF NOT EXISTS "ComprobanteElectronico_empresaId_serie_idx" ON "ComprobanteElectronico"("empresaId", "serie");

-- Búsqueda por documento cliente
CREATE INDEX IF NOT EXISTS "ComprobanteElectronico_empresaId_numeroDocumento_idx" ON "ComprobanteElectronico"("empresaId", "numeroDocumento");
