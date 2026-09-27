-- Abonos que el cliente reporta desde "Mis compras" de la tienda web (con captura).
-- No tocan el saldo hasta que la tienda los aprueba en Cuentas por cobrar.
CREATE TYPE "EstadoReporteAbono" AS ENUM ('PENDIENTE', 'APROBADO', 'RECHAZADO');

CREATE TABLE "ReporteAbono" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "ventaId" TEXT NOT NULL,
    "personaId" TEXT NOT NULL,
    "usuarioId" TEXT NOT NULL,
    "monto" DECIMAL(10,2) NOT NULL,
    "metodoPago" "MetodoPagoVenta" NOT NULL,
    "numeroOperacion" TEXT,
    "comprobanteUrl" TEXT NOT NULL,
    "empresaBancoId" TEXT,
    "estado" "EstadoReporteAbono" NOT NULL DEFAULT 'PENDIENTE',
    "motivoRechazo" TEXT,
    "pagoVentaId" TEXT,
    "revisadoPorId" TEXT,
    "revisadoEn" TIMESTAMP(3),
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReporteAbono_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ReporteAbono_pagoVentaId_key" ON "ReporteAbono"("pagoVentaId");
CREATE INDEX "ReporteAbono_empresaId_estado_idx" ON "ReporteAbono"("empresaId", "estado");
CREATE INDEX "ReporteAbono_ventaId_idx" ON "ReporteAbono"("ventaId");

ALTER TABLE "ReporteAbono" ADD CONSTRAINT "ReporteAbono_ventaId_fkey" FOREIGN KEY ("ventaId") REFERENCES "Venta"("id") ON DELETE CASCADE ON UPDATE CASCADE;
