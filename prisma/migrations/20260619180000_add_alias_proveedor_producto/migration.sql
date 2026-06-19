-- Diccionario de alias por proveedor: nombre/código que el proveedor usa para tu producto.
ALTER TABLE "ProveedorProducto" ADD COLUMN "descripcionProveedor" TEXT;
ALTER TABLE "ProveedorProducto" ADD COLUMN "codigoProveedor" TEXT;
