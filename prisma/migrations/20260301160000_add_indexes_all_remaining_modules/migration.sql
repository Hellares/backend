-- =============================================
-- MIGRACIÓN INTEGRAL: Índices compuestos para escala SaaS
-- Cubre todos los módulos pendientes de optimización
-- =============================================

-- =============================================
-- 1. CATÁLOGO (EmpresaCategoria, EmpresaMarca, EmpresaUnidadMedida)
-- Patrón SaaS: WHERE empresaId = X AND isActive = true AND deletedAt IS NULL
-- =============================================

-- EmpresaCategoria: listado con ordenamiento
CREATE INDEX IF NOT EXISTS "EmpresaCategoria_empresaId_isActive_deletedAt_orden_idx"
  ON "EmpresaCategoria" ("empresaId", "isActive", "orden")
  WHERE "deletedAt" IS NULL;

-- EmpresaMarca: listado filtrado
CREATE INDEX IF NOT EXISTS "EmpresaMarca_empresaId_isActive_deletedAt_idx"
  ON "EmpresaMarca" ("empresaId", "isActive")
  WHERE "deletedAt" IS NULL;

-- EmpresaUnidadMedida: listado filtrado
CREATE INDEX IF NOT EXISTS "EmpresaUnidadMedida_empresaId_isActive_deletedAt_idx"
  ON "EmpresaUnidadMedida" ("empresaId", "isActive")
  WHERE "deletedAt" IS NULL;

-- =============================================
-- 2. ARCHIVOS
-- Consulta: WHERE empresaId AND entidadTipo AND entidadId
-- =============================================

CREATE INDEX IF NOT EXISTS "Archivo_empresaId_entidadTipo_entidadId_idx"
  ON "Archivo" ("empresaId", "entidadTipo", "entidadId");

-- =============================================
-- 3. COMPROBANTES ELECTRÓNICOS
-- =============================================

-- Búsqueda de comprobantes por cliente
CREATE INDEX IF NOT EXISTS "ComprobanteElectronico_clienteId_idx"
  ON "ComprobanteElectronico" ("clienteId");

-- Reporte de comprobantes anulados por fecha
CREATE INDEX IF NOT EXISTS "ComprobanteElectronico_anulado_fechaEmision_idx"
  ON "ComprobanteElectronico" ("anulado", "fechaEmision")
  WHERE "anulado" = true;

-- Lookup por serie + correlativo (búsqueda de comprobante específico)
CREATE INDEX IF NOT EXISTS "ComprobanteElectronico_serie_correlativo_idx"
  ON "ComprobanteElectronico" ("serie", "correlativo");

-- =============================================
-- 4. EMPRESA (marketplace)
-- =============================================

-- Listado marketplace: empresas visibles, activas, ordenadas
CREATE INDEX IF NOT EXISTS "Empresa_marketplace_listing_idx"
  ON "Empresa" ("isActive", "visibleEnMarketplace", "ordenMarketplace")
  WHERE "deletedAt" IS NULL AND "visibleEnMarketplace" = true;

-- Búsqueda marketplace por nombre de empresa (trigram)
CREATE INDEX IF NOT EXISTS "Empresa_nombre_trgm_idx"
  ON "Empresa" USING GIN ("nombre" gin_trgm_ops);

-- =============================================
-- 5. MOVIMIENTO STOCK
-- =============================================

-- Reportes por empresa + sede + rango de fechas
CREATE INDEX IF NOT EXISTS "MovimientoStock_empresaId_sedeId_creadoEn_idx"
  ON "MovimientoStock" ("empresaId", "sedeId", "creadoEn");

-- Reportes por empresa + tipo de movimiento + fecha
CREATE INDEX IF NOT EXISTS "MovimientoStock_empresaId_tipo_creadoEn_idx"
  ON "MovimientoStock" ("empresaId", "tipo", "creadoEn");

-- =============================================
-- 6. PROVEEDOR
-- =============================================

-- Búsqueda por nombre de proveedor (trigram para ILIKE '%valor%')
CREATE INDEX IF NOT EXISTS "Proveedor_nombre_trgm_idx"
  ON "Proveedor" USING GIN ("nombre" gin_trgm_ops);

-- Búsqueda por número de documento (trigram)
CREATE INDEX IF NOT EXISTS "Proveedor_numeroDocumento_trgm_idx"
  ON "Proveedor" USING GIN ("numeroDocumento" gin_trgm_ops);

-- Listado ordenado por nombre (para ORDER BY nombre)
CREATE INDEX IF NOT EXISTS "Proveedor_empresaId_isActive_nombre_idx"
  ON "Proveedor" ("empresaId", "isActive", "nombre");

-- ProveedorProducto: consulta "proveedores de un producto"
CREATE INDEX IF NOT EXISTS "ProveedorProducto_empresaId_productoId_idx"
  ON "ProveedorProducto" ("empresaId", "productoId");

-- ProveedorEvaluacion: evaluaciones de un proveedor en una empresa
CREATE INDEX IF NOT EXISTS "ProveedorEvaluacion_proveedorId_empresaId_idx"
  ON "ProveedorEvaluacion" ("proveedorId", "empresaId");

-- =============================================
-- 7. TRANSFERENCIA STOCK
-- =============================================

-- Transferencias salientes de una sede
CREATE INDEX IF NOT EXISTS "TransferenciaStock_sedeOrigenId_estado_idx"
  ON "TransferenciaStock" ("sedeOrigenId", "estado");

-- Transferencias entrantes a una sede
CREATE INDEX IF NOT EXISTS "TransferenciaStock_sedeDestinoId_estado_idx"
  ON "TransferenciaStock" ("sedeDestinoId", "estado");

-- =============================================
-- 8. INVENTARIO
-- =============================================

-- Búsqueda por código (startsWith) dentro de empresa
CREATE INDEX IF NOT EXISTS "Inventario_empresaId_codigo_idx"
  ON "Inventario" ("empresaId", "codigo");

-- Items pendientes de ajuste dentro de un inventario
CREATE INDEX IF NOT EXISTS "InventarioItem_inventarioId_ajusteAplicado_idx"
  ON "InventarioItem" ("inventarioId", "ajusteAplicado");

-- =============================================
-- 9. DEVOLUCIÓN
-- =============================================

-- Consulta por cliente (futuro: historial de devoluciones del cliente)
CREATE INDEX IF NOT EXISTS "Devolucion_clienteId_idx"
  ON "Devolucion" ("clienteId")
  WHERE "clienteId" IS NOT NULL;

-- Listado por empresa
CREATE INDEX IF NOT EXISTS "Devolucion_empresaId_idx"
  ON "Devolucion" ("empresaId");

-- Listado por empresa + estado + fecha (reportes)
CREATE INDEX IF NOT EXISTS "Devolucion_empresaId_estado_creadoEn_idx"
  ON "Devolucion" ("empresaId", "estado", "creadoEn");

-- =============================================
-- 10. SERVICIO
-- =============================================

-- findAll SaaS: empresaId + isActive filtrado por deletedAt
CREATE INDEX IF NOT EXISTS "Servicio_empresaId_isActive_deletedAt_idx"
  ON "Servicio" ("empresaId", "isActive")
  WHERE "deletedAt" IS NULL;

-- Búsqueda por nombre de servicio (trigram)
CREATE INDEX IF NOT EXISTS "Servicio_nombre_trgm_idx"
  ON "Servicio" USING GIN ("nombre" gin_trgm_ops);

-- =============================================
-- 11. DESCUENTO USO HISTORIAL
-- =============================================

-- Consulta por política + empresa
CREATE INDEX IF NOT EXISTS "DescuentoUsoHistorial_politicaId_empresaId_idx"
  ON "DescuentoUsoHistorial" ("politicaId", "empresaId");

-- Reportes de uso por empresa + fecha
CREATE INDEX IF NOT EXISTS "DescuentoUsoHistorial_empresaId_creadoEn_idx"
  ON "DescuentoUsoHistorial" ("empresaId", "creadoEn");

-- =============================================
-- 12. POLÍTICA DESCUENTO
-- =============================================

-- Políticas vigentes (activas + no eliminadas)
CREATE INDEX IF NOT EXISTS "PoliticaDescuento_empresaId_isActive_deletedAt_idx"
  ON "PoliticaDescuento" ("empresaId", "isActive")
  WHERE "deletedAt" IS NULL;

-- =============================================
-- 13. ORDEN SERVICIO
-- =============================================

-- Órdenes por cliente (historial de servicios del cliente)
CREATE INDEX IF NOT EXISTS "OrdenServicio_empresaId_clienteId_idx"
  ON "OrdenServicio" ("empresaId", "clienteId");

-- Órdenes asignadas a un técnico
CREATE INDEX IF NOT EXISTS "OrdenServicio_empresaId_tecnicoId_estado_idx"
  ON "OrdenServicio" ("empresaId", "tecnicoId", "estado");
