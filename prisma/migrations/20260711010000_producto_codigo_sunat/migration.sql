-- Código de producto SUNAT (UNSPSC, catálogos 25/25.1/25.2/25.3) por producto.
-- Opcional: solo viaja al XML de facturación cuando está seteado.

ALTER TABLE "Producto" ADD COLUMN "codigoProductoSunat" TEXT;
