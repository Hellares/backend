-- =========================================
-- FLAG esInsumo en Producto
-- =========================================
-- Marca productos como materia prima / insumo. Productos así marcados
-- están OCULTOS automáticamente de marketplace, carrito B2C y POS.
-- Solo aparecen al definir componentes de productos compuestos (BOM).
--
-- Default false → todos los productos existentes mantienen el comportamiento
-- actual (vendibles). Cambio NO destructivo.

-- AlterTable
ALTER TABLE "Producto" ADD COLUMN "esInsumo" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex: filtro común para listar insumos / excluir insumos rápido
CREATE INDEX "Producto_empresaId_esInsumo_isActive_idx"
  ON "Producto"("empresaId", "esInsumo", "isActive");
