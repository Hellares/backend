-- Codigo del proveedor y garantia en la linea de compra.
--
-- Todo ADITIVO y nullable: ninguna fila existente cambia y el codigo viejo
-- sigue andando sin tocar nada.
--
-- El diccionario de alias (`ProveedorProducto`) YA existia, con su columna
-- `codigoProveedor` sin usar: lo que se agrega aca es el snapshot en la linea,
-- la garantia, los datos de la ultima compra y los indices para poder BUSCAR
-- un producto por el codigo del proveedor.

-- AlterTable
ALTER TABLE "CompraDetalle" ADD COLUMN "codigoProveedor" TEXT;
ALTER TABLE "CompraDetalle" ADD COLUMN "garantiaMeses" INTEGER;

-- AlterTable
ALTER TABLE "ProveedorProducto" ADD COLUMN "ultimoPrecio" DECIMAL(14,6);
ALTER TABLE "ProveedorProducto" ADD COLUMN "ultimaMoneda" TEXT;
ALTER TABLE "ProveedorProducto" ADD COLUMN "ultimaCompraAt" TIMESTAMP(3);

-- CreateIndex
-- Buscar el producto POR el codigo del proveedor al cargar una compra.
CREATE INDEX "ProveedorProducto_empresaId_codigoProveedor_idx"
  ON "ProveedorProducto"("empresaId", "codigoProveedor");

-- CreateIndex
-- 🔴 UN codigo = UN producto, por proveedor. Va PARCIAL (`WHERE ... IS NOT
-- NULL`) porque casi todas las filas no tienen codigo y un unique normal las
-- dejaria pasar igual en Postgres, pero Prisma no sabe expresar el parcial:
-- por eso el indice se crea aca y el schema solo declara el indice comun.
CREATE UNIQUE INDEX "ProveedorProducto_proveedorId_codigoProveedor_key"
  ON "ProveedorProducto"("proveedorId", "codigoProveedor")
  WHERE "codigoProveedor" IS NOT NULL;

-- Sin indice trigram a proposito: el buscador resuelve los codigos por
-- IGUALDAD (la rama `pareceCodigo` de `buildWhereClause`), no con ILIKE
-- '%...%', asi que el btree de arriba alcanza. Un GIN de mas solo costaria
-- escrituras y disco.
