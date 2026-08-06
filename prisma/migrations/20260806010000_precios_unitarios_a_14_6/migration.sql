-- Precios UNITARIOS de Decimal(14,4) a Decimal(14,6).
--
-- Un precio unitario no es un monto: se multiplica por la cantidad, así que
-- el error de redondeo se amplifica cuando la unidad atómica es chica.
--   · Saco de 22 kg a S/147.99 con base en gramos = S/0.006727/g. A 4
--     decimales queda 0.0067 → ×22 000 vuelve como S/147.40 y la compra deja
--     de cuadrar con la factura del proveedor.
--   · Cuero a 0.048772/cm quedaba en 0.0488.
-- Con 6 decimales la granularidad por kilo es de S/0.001.
--
-- Los MONTOS (subtotal, igv, total, descuento) NO se tocan: siguen en 2
-- decimales, que es lo que exige SUNAT.
--
-- DetalleComprobante.precioUnitario y .valorUnitario quedan en (14,4) a
-- propósito: son la frontera fiscal y su precisión la define el proveedor de
-- facturación, no nosotros. Revisar antes de vender por gramo.
--
-- Ampliar la escala de un numeric es una operación sin pérdida: 0.0067 pasa a
-- 0.006700. Postgres reescribe la tabla, pero a la escala de esta base
-- (cientos de filas por tabla) es instantáneo.

ALTER TABLE "CompraDetalle"
  ALTER COLUMN "precioUnitario" TYPE numeric(14,6),
  ALTER COLUMN "nuevoPrecioVenta" TYPE numeric(14,6);

ALTER TABLE "OrdenCompraDetalle"
  ALTER COLUMN "precioUnitario" TYPE numeric(14,6);

ALTER TABLE "Lote"
  ALTER COLUMN "precioCosto" TYPE numeric(14,6);

ALTER TABLE "CotizacionDetalle"
  ALTER COLUMN "precioUnitario" TYPE numeric(14,6),
  ALTER COLUMN "precioRegular" TYPE numeric(14,6),
  ALTER COLUMN "precioAntesOferta" TYPE numeric(14,6);

ALTER TABLE "PedidoMarketplaceDetalle"
  ALTER COLUMN "precioUnitario" TYPE numeric(14,6);

ALTER TABLE "PrecioNivel"
  ALTER COLUMN "precio" TYPE numeric(14,6);

ALTER TABLE "ProductoCombo"
  ALTER COLUMN "precioEnCombo" TYPE numeric(14,6);

ALTER TABLE "MovimientoStock"
  ALTER COLUMN "precioCostoUnitario" TYPE numeric(14,6);

ALTER TABLE "ProductoStock"
  ALTER COLUMN "precio" TYPE numeric(14,6),
  ALTER COLUMN "precioCosto" TYPE numeric(14,6),
  ALTER COLUMN "precioOferta" TYPE numeric(14,6),
  ALTER COLUMN "precioLiquidacion" TYPE numeric(14,6);

ALTER TABLE "ProductoPrecioHistorial"
  ALTER COLUMN "precioAnterior" TYPE numeric(14,6),
  ALTER COLUMN "precioNuevo" TYPE numeric(14,6),
  ALTER COLUMN "precioCostoAnterior" TYPE numeric(14,6),
  ALTER COLUMN "precioCostoNuevo" TYPE numeric(14,6);

ALTER TABLE "ProductoPrecioHistorialSede"
  ALTER COLUMN "precioAnterior" TYPE numeric(14,6),
  ALTER COLUMN "precioNuevo" TYPE numeric(14,6),
  ALTER COLUMN "precioCostoAnterior" TYPE numeric(14,6),
  ALTER COLUMN "precioCostoNuevo" TYPE numeric(14,6),
  ALTER COLUMN "precioOfertaAnterior" TYPE numeric(14,6),
  ALTER COLUMN "precioOfertaNuevo" TYPE numeric(14,6);

ALTER TABLE "VentaDetalle"
  ALTER COLUMN "precioUnitario" TYPE numeric(14,6),
  ALTER COLUMN "precioCostoSnapshot" TYPE numeric(14,6),
  ALTER COLUMN "margenSnapshot" TYPE numeric(14,6);
