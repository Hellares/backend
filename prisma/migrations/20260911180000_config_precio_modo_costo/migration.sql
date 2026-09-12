-- VENDER A COSTO: con que costo arranca el interruptor del POS.
--
-- COSTO_LOTE (default) = lo que costo la unidad en la ULTIMA compra, con el
-- flete prorrateado adentro. Cuando esa compra no trajo flete —el caso normal
-- de un mayorista de tecnologia— es exactamente el costo de la factura que
-- emitio el proveedor, que es lo que se quiere revender.
-- COSTO_LOTE_SIN_FLETE = ese mismo neto de factura sin el flete prorrateado.
-- COSTO_PROMEDIO = la mezcla de todas las compras (el que valora el kardex).
--
-- Es SOLO el valor con el que abre el interruptor: el cajero puede cambiarlo
-- en el momento, por carrito o por linea.
--
-- ADITIVA con DEFAULT: las empresas ya creadas quedan en COSTO_LOTE y nada
-- cambia para ellas hasta que alguien prenda el interruptor a mano.
ALTER TABLE "ConfiguracionEmpresa"
  ADD COLUMN "precioModoCostoDefault" TEXT NOT NULL DEFAULT 'COSTO_LOTE';
