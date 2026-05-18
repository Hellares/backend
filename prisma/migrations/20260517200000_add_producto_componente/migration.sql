-- =========================================
-- PRODUCTO COMPUESTO / BOM (Bill of Materials)
-- =========================================
--
-- Tabla para definir la "receta" de un producto que se arma a partir
-- de componentes/insumos. Distinto del Combo (que agrupa productos ya
-- terminados al venderse). Este módulo solo calcula costo en el MVP,
-- no toca stock.
--
-- Cantidad va en la unidad nativa del componente (Decimal 12,4):
-- 0.0500 KG = 50 g, 0.30 M = 30 cm, 1 UND = 1 pieza.

-- CreateTable
CREATE TABLE "ProductoComponente" (
    "id" TEXT NOT NULL,
    "productoId" TEXT NOT NULL,
    "componenteId" TEXT NOT NULL,
    "cantidad" DECIMAL(12,4) NOT NULL,
    "notas" TEXT,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductoComponente_pkey" PRIMARY KEY ("id")
);

-- CreateIndex (unique: no duplicar el mismo componente en una receta)
CREATE UNIQUE INDEX "ProductoComponente_productoId_componenteId_key"
    ON "ProductoComponente"("productoId", "componenteId");

-- CreateIndex
CREATE INDEX "ProductoComponente_productoId_idx" ON "ProductoComponente"("productoId");

-- CreateIndex
CREATE INDEX "ProductoComponente_componenteId_idx" ON "ProductoComponente"("componenteId");

-- AddForeignKey: producto final (cascade — si se borra el producto, se va la receta)
ALTER TABLE "ProductoComponente" ADD CONSTRAINT "ProductoComponente_productoId_fkey"
    FOREIGN KEY ("productoId") REFERENCES "Producto"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: componente (restrict — no permitir borrar un componente que está siendo usado en alguna receta)
ALTER TABLE "ProductoComponente" ADD CONSTRAINT "ProductoComponente_componenteId_fkey"
    FOREIGN KEY ("componenteId") REFERENCES "Producto"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
