-- AlterTable: ConfiguracionEmpresa - interés por crédito
ALTER TABLE "ConfiguracionEmpresa" ADD COLUMN     "interesEsEditable" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "interesHabilitado" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "porcentajeInteresDefault" DECIMAL(5,2) DEFAULT 0;

-- AlterTable: Venta - snapshot del interés aplicado
ALTER TABLE "Venta" ADD COLUMN     "montoInteres" DECIMAL(10,2),
ADD COLUMN     "porcentajeInteres" DECIMAL(5,2),
ADD COLUMN     "totalConInteres" DECIMAL(10,2);

-- AlterTable: CuotaVenta - desglose principal/interés + tracking pagos
ALTER TABLE "CuotaVenta" ADD COLUMN     "montoInteres" DECIMAL(10,2) NOT NULL DEFAULT 0,
ADD COLUMN     "montoPagadoInteres" DECIMAL(10,2) NOT NULL DEFAULT 0,
ADD COLUMN     "montoPagadoMora" DECIMAL(10,2) NOT NULL DEFAULT 0,
ADD COLUMN     "montoPagadoPrincipal" DECIMAL(10,2) NOT NULL DEFAULT 0,
ADD COLUMN     "montoPrincipal" DECIMAL(10,2) NOT NULL DEFAULT 0;

-- AlterTable: PagoVenta - desglose de cada pago
ALTER TABLE "PagoVenta" ADD COLUMN     "montoInteres" DECIMAL(10,2),
ADD COLUMN     "montoMora" DECIMAL(10,2),
ADD COLUMN     "montoPrincipal" DECIMAL(10,2);

-- AlterTable: MovimientoCaja - metadata para reportes
ALTER TABLE "MovimientoCaja" ADD COLUMN     "metadata" JSONB;

-- Backfill: cuotas existentes → montoPrincipal = monto (sin interés)
UPDATE "CuotaVenta"
SET "montoPrincipal" = "monto",
    "montoInteres" = 0,
    "montoPagadoPrincipal" = "montoPagado",
    "montoPagadoInteres" = 0,
    "montoPagadoMora" = 0
WHERE "montoPrincipal" = 0 AND "monto" > 0;
