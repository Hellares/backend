-- Categoría del catálogo de gastos en los gastos de la factura de compra.
--
-- El `concepto` de texto libre no se puede agrupar: "MOVILIDAD",
-- "MOVILIDAD LIMA A TRUJILLO" y "MOVILIDAD TRUJILLO A TIENDA" son tres filas
-- distintas para cualquier reporte. La categoría es el catálogo que ya usan
-- caja chica, los movimientos de caja y los gastos recurrentes, así que el
-- total de movilidad del año sale de todas las fuentes junto y no solo de las
-- facturas de proveedor.
--
-- ADITIVA y NULLABLE: los gastos ya cargados quedan sin categoría y siguen
-- funcionando igual. Al 26-08 hay 0 filas en prod y 3 en beta, así que no hay
-- nada que clasificar hacia atrás.
--
-- Escrita a mano y NO con `prisma migrate dev`: ese comando dropea los índices
-- GIN trigram que Compra y compañía tienen creados con SQL crudo.

-- AlterTable
ALTER TABLE "CompraGasto" ADD COLUMN "categoriaGastoId" TEXT;

-- CreateIndex
CREATE INDEX "CompraGasto_categoriaGastoId_idx" ON "CompraGasto"("categoriaGastoId");

-- AddForeignKey
-- SetNull: borrar una categoría no puede llevarse puesto el gasto de una
-- compra ya confirmada (ese monto es parte del costo del inventario).
ALTER TABLE "CompraGasto" ADD CONSTRAINT "CompraGasto_categoriaGastoId_fkey"
    FOREIGN KEY ("categoriaGastoId") REFERENCES "CategoriaGasto"("id") ON DELETE SET NULL ON UPDATE CASCADE;
