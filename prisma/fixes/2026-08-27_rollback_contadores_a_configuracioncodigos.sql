-- ROLLBACK de la migración 20260827000000_contador_codigo_fila_por_tipo.
--
-- Desde esa migración los 22 contadores de código viven en `ContadorCodigo`
-- (una fila por empresa y tipo) y las columnas `ultimo*` de
-- `ConfiguracionCodigos` quedaron congeladas.
--
-- CUÁNDO CORRERLO: solo si se revierte el backend a una imagen ANTERIOR al
-- 27-08. El código viejo lee las columnas; si no se les copia el valor real,
-- vuelve a entregar códigos ya usados y las ventas empiezan a fallar contra
-- `@@unique([empresaId, codigo])` — el mostrador queda sin poder vender.
--
-- Es idempotente y nunca hace retroceder un contador (GREATEST).
--
--   docker exec -i postgres psql -U postgres -d db_saas \
--     < prisma/fixes/2026-08-27_rollback_contadores_a_configuracioncodigos.sql

BEGIN;

UPDATE "ConfiguracionCodigos" c
SET
    "ultimoProducto"            = GREATEST(c."ultimoProducto",            COALESCE(v."PRODUCTO", 0)),
    "ultimoServicio"            = GREATEST(c."ultimoServicio",            COALESCE(v."SERVICIO", 0)),
    "ultimaVariante"            = GREATEST(c."ultimaVariante",            COALESCE(v."VARIANTE", 0)),
    "ultimaVenta"               = GREATEST(c."ultimaVenta",               COALESCE(v."VENTA", 0)),
    "ultimoComponente"          = GREATEST(c."ultimoComponente",          COALESCE(v."COMPONENTE", 0)),
    "ultimaCotizacion"          = GREATEST(c."ultimaCotizacion",          COALESCE(v."COTIZACION", 0)),
    "ultimaOrdenServicio"       = GREATEST(c."ultimaOrdenServicio",       COALESCE(v."ORDEN_SERVICIO", 0)),
    "ultimoProveedor"           = GREATEST(c."ultimoProveedor",           COALESCE(v."PROVEEDOR", 0)),
    "ultimaTransferencia"       = GREATEST(c."ultimaTransferencia",       COALESCE(v."TRANSFERENCIA", 0)),
    "ultimaOrdenCompra"         = GREATEST(c."ultimaOrdenCompra",         COALESCE(v."ORDEN_COMPRA", 0)),
    "ultimaCompra"              = GREATEST(c."ultimaCompra",              COALESCE(v."COMPRA", 0)),
    "ultimoLote"                = GREATEST(c."ultimoLote",                COALESCE(v."LOTE", 0)),
    "ultimaSede"                = GREATEST(c."ultimaSede",                COALESCE(v."SEDE", 0)),
    "ultimoReporteIncidencia"   = GREATEST(c."ultimoReporteIncidencia",   COALESCE(v."REPORTE_INCIDENCIA", 0)),
    "ultimoInventario"          = GREATEST(c."ultimoInventario",          COALESCE(v."INVENTARIO", 0)),
    "ultimoClienteEmpresa"      = GREATEST(c."ultimoClienteEmpresa",      COALESCE(v."CLIENTE_EMPRESA", 0)),
    "ultimaCita"                = GREATEST(c."ultimaCita",                COALESCE(v."CITA", 0)),
    "ultimoPedidoMarketplace"   = GREATEST(c."ultimoPedidoMarketplace",   COALESCE(v."PEDIDO_MARKETPLACE", 0)),
    "ultimaSolicitudCotizacion" = GREATEST(c."ultimaSolicitudCotizacion", COALESCE(v."SOLICITUD_COTIZACION", 0)),
    "ultimaCaja"                = GREATEST(c."ultimaCaja",                COALESCE(v."CAJA", 0)),
    "ultimaRendicion"           = GREATEST(c."ultimaRendicion",           COALESCE(v."RENDICION", 0)),
    "ultimoEmpleado"            = GREATEST(c."ultimoEmpleado",            COALESCE(v."EMPLEADO", 0))
FROM (
    SELECT
        "empresaId",
        MAX(valor) FILTER (WHERE tipo = 'PRODUCTO')             AS "PRODUCTO",
        MAX(valor) FILTER (WHERE tipo = 'SERVICIO')             AS "SERVICIO",
        MAX(valor) FILTER (WHERE tipo = 'VARIANTE')             AS "VARIANTE",
        MAX(valor) FILTER (WHERE tipo = 'VENTA')                AS "VENTA",
        MAX(valor) FILTER (WHERE tipo = 'COMPONENTE')           AS "COMPONENTE",
        MAX(valor) FILTER (WHERE tipo = 'COTIZACION')           AS "COTIZACION",
        MAX(valor) FILTER (WHERE tipo = 'ORDEN_SERVICIO')       AS "ORDEN_SERVICIO",
        MAX(valor) FILTER (WHERE tipo = 'PROVEEDOR')            AS "PROVEEDOR",
        MAX(valor) FILTER (WHERE tipo = 'TRANSFERENCIA')        AS "TRANSFERENCIA",
        MAX(valor) FILTER (WHERE tipo = 'ORDEN_COMPRA')         AS "ORDEN_COMPRA",
        MAX(valor) FILTER (WHERE tipo = 'COMPRA')               AS "COMPRA",
        MAX(valor) FILTER (WHERE tipo = 'LOTE')                 AS "LOTE",
        MAX(valor) FILTER (WHERE tipo = 'SEDE')                 AS "SEDE",
        MAX(valor) FILTER (WHERE tipo = 'REPORTE_INCIDENCIA')   AS "REPORTE_INCIDENCIA",
        MAX(valor) FILTER (WHERE tipo = 'INVENTARIO')           AS "INVENTARIO",
        MAX(valor) FILTER (WHERE tipo = 'CLIENTE_EMPRESA')      AS "CLIENTE_EMPRESA",
        MAX(valor) FILTER (WHERE tipo = 'CITA')                 AS "CITA",
        MAX(valor) FILTER (WHERE tipo = 'PEDIDO_MARKETPLACE')   AS "PEDIDO_MARKETPLACE",
        MAX(valor) FILTER (WHERE tipo = 'SOLICITUD_COTIZACION') AS "SOLICITUD_COTIZACION",
        MAX(valor) FILTER (WHERE tipo = 'CAJA')                 AS "CAJA",
        MAX(valor) FILTER (WHERE tipo = 'RENDICION')            AS "RENDICION",
        MAX(valor) FILTER (WHERE tipo = 'EMPLEADO')             AS "EMPLEADO"
    FROM "ContadorCodigo"
    GROUP BY "empresaId"
) v
WHERE v."empresaId" = c."empresaId";

COMMIT;
