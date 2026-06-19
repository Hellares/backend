-- Comprobante DIFERIDO (flujo Yape pendiente): cuando la venta nace BORRADOR
-- esperando el pago Yape/Plin, el comprobante se emite al CONFIRMARSE el pago,
-- no al crear. Estos 3 campos persisten la intención fiscal que antes vivía
-- solo en el DTO. Nullable: null en ventas normales (no diferidas).
ALTER TABLE "Venta" ADD COLUMN "tipoComprobanteDiferido" TEXT;
ALTER TABLE "Venta" ADD COLUMN "sedeFacturacionIdDiferido" TEXT;
ALTER TABLE "Venta" ADD COLUMN "tipoDocumentoClienteDiferido" TEXT;

-- Marca de cobro Yape/Plin diferido (venta CONFIRMADA pendiente de pago, sin
-- comprobante). Si se cancela/expira sin pagar → se BORRA (devuelve stock).
ALTER TABLE "Venta" ADD COLUMN "cobroDiferido" BOOLEAN NOT NULL DEFAULT false;
