-- Unidades de REGALO dentro de la cantidad recibida de una linea de compra.
--
-- La promo "10+1" del proveedor entra como cantidad=11 + cantidadBonificada=1:
-- las 11 unidades llegaron fisicamente y entran al stock, pero solo se pagan
-- 10, asi que el costo que toca el inventario es el prorrateado entre las 11
-- (136.00 / 11 = 12.3636), que es el mismo numero que el proveedor imprime en
-- su propia linea de promocion.
--
-- Es distinto del `descuento` de la linea, que es una rebaja en PLATA sobre lo
-- que si se paga. Los dos pueden convivir.
--
-- ADITIVA con DEFAULT 0: las lineas ya cargadas quedan sin bonificacion y la
-- formula del importe (cantidad - bonificada) * precio - descuento les da
-- exactamente lo mismo que antes.
ALTER TABLE "CompraDetalle"
  ADD COLUMN "cantidadBonificada" INTEGER NOT NULL DEFAULT 0;
