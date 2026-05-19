-- Migración no-destructiva: expandir precisión de precios de
-- Decimal(10,2) o Decimal(12,2) a Decimal(14,4).
-- Motivación: soportar productos vendidos por unidad atómica chica
-- (gramos, mililitros, centímetros) donde el precio unitario puede
-- caer en S/0.003 y el redondeo a 2 decimales pierde el valor.
-- Subtotales/IGV/totales mantienen 2 decimales (estándar SUNAT).
-- Los valores existentes se preservan (S/10.50 → S/10.5000).

-- ProductoStock (precios por sede)
ALTER TABLE "ProductoStock" ALTER COLUMN "precio" TYPE DECIMAL(14, 4);
ALTER TABLE "ProductoStock" ALTER COLUMN "precioCosto" TYPE DECIMAL(14, 4);
ALTER TABLE "ProductoStock" ALTER COLUMN "precioOferta" TYPE DECIMAL(14, 4);
ALTER TABLE "ProductoStock" ALTER COLUMN "precioLiquidacion" TYPE DECIMAL(14, 4);

-- CompraDetalle
ALTER TABLE "CompraDetalle" ALTER COLUMN "precioUnitario" TYPE DECIMAL(14, 4);

-- OrdenCompraDetalle
ALTER TABLE "OrdenCompraDetalle" ALTER COLUMN "precioUnitario" TYPE DECIMAL(14, 4);

-- Lote (costo unitario por lote de compra)
ALTER TABLE "Lote" ALTER COLUMN "precioCosto" TYPE DECIMAL(14, 4);

-- VentaDetalle
ALTER TABLE "VentaDetalle" ALTER COLUMN "precioUnitario" TYPE DECIMAL(14, 4);
ALTER TABLE "VentaDetalle" ALTER COLUMN "precioCostoSnapshot" TYPE DECIMAL(14, 4);
ALTER TABLE "VentaDetalle" ALTER COLUMN "margenSnapshot" TYPE DECIMAL(14, 4);

-- CotizacionDetalle
ALTER TABLE "CotizacionDetalle" ALTER COLUMN "precioUnitario" TYPE DECIMAL(14, 4);

-- DetalleComprobante (lo que se manda a SUNAT)
ALTER TABLE "DetalleComprobante" ALTER COLUMN "valorUnitario" TYPE DECIMAL(14, 4);
ALTER TABLE "DetalleComprobante" ALTER COLUMN "precioUnitario" TYPE DECIMAL(14, 4);

-- PrecioNivel (precio fijo por nivel/mayor)
ALTER TABLE "PrecioNivel" ALTER COLUMN "precio" TYPE DECIMAL(14, 4);

-- PedidoMarketplaceDetalle
ALTER TABLE "PedidoMarketplaceDetalle" ALTER COLUMN "precioUnitario" TYPE DECIMAL(14, 4);

-- ProductoCombo (precio override del componente en combo)
ALTER TABLE "ProductoCombo" ALTER COLUMN "precioEnCombo" TYPE DECIMAL(14, 4);

-- ProductoPrecioHistorial (auditoría)
ALTER TABLE "ProductoPrecioHistorial" ALTER COLUMN "precioAnterior" TYPE DECIMAL(14, 4);
ALTER TABLE "ProductoPrecioHistorial" ALTER COLUMN "precioNuevo" TYPE DECIMAL(14, 4);
ALTER TABLE "ProductoPrecioHistorial" ALTER COLUMN "precioCostoAnterior" TYPE DECIMAL(14, 4);
ALTER TABLE "ProductoPrecioHistorial" ALTER COLUMN "precioCostoNuevo" TYPE DECIMAL(14, 4);

-- ProductoPrecioHistorialSede (auditoría por sede)
ALTER TABLE "ProductoPrecioHistorialSede" ALTER COLUMN "precioAnterior" TYPE DECIMAL(14, 4);
ALTER TABLE "ProductoPrecioHistorialSede" ALTER COLUMN "precioNuevo" TYPE DECIMAL(14, 4);
ALTER TABLE "ProductoPrecioHistorialSede" ALTER COLUMN "precioCostoAnterior" TYPE DECIMAL(14, 4);
ALTER TABLE "ProductoPrecioHistorialSede" ALTER COLUMN "precioCostoNuevo" TYPE DECIMAL(14, 4);
ALTER TABLE "ProductoPrecioHistorialSede" ALTER COLUMN "precioOfertaAnterior" TYPE DECIMAL(14, 4);
ALTER TABLE "ProductoPrecioHistorialSede" ALTER COLUMN "precioOfertaNuevo" TYPE DECIMAL(14, 4);
