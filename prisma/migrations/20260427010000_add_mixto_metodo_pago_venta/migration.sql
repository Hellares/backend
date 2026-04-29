-- Multi-medio de pago: agregar valor MIXTO al enum.
-- Se usa en Venta.metodoPago cuando una venta tiene >1 método distinto en sus PagoVenta.
-- La fuente de verdad para reportería sigue siendo PagoVenta (1 fila por método real).

ALTER TYPE "MetodoPagoVenta" ADD VALUE IF NOT EXISTS 'MIXTO';
