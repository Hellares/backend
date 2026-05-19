-- Fase B del módulo BOM: agregar tipos de movimiento PRODUCCION_*
-- al kardex para registrar la fabricación de un producto desde sus
-- componentes (PRODUCCION_ENTRADA suma al final, PRODUCCION_SALIDA
-- descuenta los insumos consumidos).

ALTER TYPE "TipoMovimientoStock" ADD VALUE 'PRODUCCION_ENTRADA';
ALTER TYPE "TipoMovimientoStock" ADD VALUE 'PRODUCCION_SALIDA';
