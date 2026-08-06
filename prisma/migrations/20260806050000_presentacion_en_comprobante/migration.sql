-- La unidad de presentación llega al comprobante y al ticket (fase 2).
--
-- Hasta acá la presentación era capa de vista del catálogo: el producto se
-- guarda en gramos y la app lo muestra en kilos. Pero al VENDER, el ticket
-- imprimía "1500" y "S/0.01", y el comprobante salía con NIU fijo — o sea que
-- el documento que se lleva el cliente (y el que ve SUNAT) seguía hablando en
-- una unidad que nadie usa, con un precio unitario redondeado a un centavo
-- que no es el precio real.
--
-- Se guarda como SNAPSHOT en la línea, no se resuelve del Producto al
-- imprimir: si mañana el producto cambia de presentación, el ticket reimpreso
-- de una venta vieja tiene que seguir diciendo lo que se cobró ese día.
--
--   unidadPresentacionSimbolo  "kg"   → lo que se imprime en el ticket
--   factorPresentacion         1000   → unidades de venta que trae 1 de esas
--   codigoUnidadSunat          "KGM"  → la unidad en la que se DECLARA la línea
--
-- `codigoUnidadSunat` aplica también a productos SIN presentación: hoy toda
-- línea sale como NIU aunque el producto se venda en kilos o metros. Nullable
-- porque las líneas ya emitidas no se tocan; el mapper cae a NIU como siempre.

ALTER TABLE "VentaDetalle"
  ADD COLUMN IF NOT EXISTS "unidadPresentacionSimbolo" VARCHAR(20),
  ADD COLUMN IF NOT EXISTS "factorPresentacion" numeric(12,4),
  ADD COLUMN IF NOT EXISTS "codigoUnidadSunat" VARCHAR(5);

-- Cantidad del comprobante: de 2 a 3 decimales.
--
-- Con la unidad atómica en gramos y presentación en kilos, la cantidad
-- declarada se DIVIDE por 1000: 1237 g son 1.237 kg. Con 2 decimales eso se
-- guardaba como 1.24 y la línea dejaba de cuadrar — 1.24 × 8.00 = 9.92 contra
-- los 9.90 que el cliente pagó. Tres decimales es exactamente 1 gramo, que es
-- la resolución de una balanza de retail, así que no se pierde nada.
--
-- Ampliar la escala de un numeric no reescribe la tabla ni pierde datos.
ALTER TABLE "DetalleComprobante"
  ALTER COLUMN "cantidad" TYPE numeric(12,3);
