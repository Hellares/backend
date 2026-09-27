-- Un pago reportado por el cliente puede cubrir VARIAS compras (una
-- transferencia grande que salda varias ventas). La venta y el abono
-- registrado pasan de la cabecera a una línea por compra.

CREATE TABLE "ReporteAbonoVenta" (
    "id" TEXT NOT NULL,
    "reporteId" TEXT NOT NULL,
    "ventaId" TEXT NOT NULL,
    "monto" DECIMAL(10,2) NOT NULL,
    "pagoVentaId" TEXT,

    CONSTRAINT "ReporteAbonoVenta_pkey" PRIMARY KEY ("id")
);

-- Los que ya existían eran de UNA compra: una línea con su monto y su abono.
-- md5() en vez de gen_random_uuid() para no depender de pgcrypto.
INSERT INTO "ReporteAbonoVenta" ("id", "reporteId", "ventaId", "monto", "pagoVentaId")
SELECT 'rav' || substr(md5("id" || "ventaId"), 1, 22), "id", "ventaId", "monto", "pagoVentaId"
FROM "ReporteAbono";

CREATE UNIQUE INDEX "ReporteAbonoVenta_pagoVentaId_key" ON "ReporteAbonoVenta"("pagoVentaId");
CREATE INDEX "ReporteAbonoVenta_ventaId_idx" ON "ReporteAbonoVenta"("ventaId");
CREATE UNIQUE INDEX "ReporteAbonoVenta_reporteId_ventaId_key" ON "ReporteAbonoVenta"("reporteId", "ventaId");

ALTER TABLE "ReporteAbonoVenta" ADD CONSTRAINT "ReporteAbonoVenta_reporteId_fkey" FOREIGN KEY ("reporteId") REFERENCES "ReporteAbono"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ReporteAbonoVenta" ADD CONSTRAINT "ReporteAbonoVenta_ventaId_fkey" FOREIGN KEY ("ventaId") REFERENCES "Venta"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- La cabecera ya no apunta a una venta ni a un abono.
ALTER TABLE "ReporteAbono" DROP CONSTRAINT "ReporteAbono_ventaId_fkey";
DROP INDEX "ReporteAbono_ventaId_idx";
DROP INDEX "ReporteAbono_pagoVentaId_key";
ALTER TABLE "ReporteAbono" DROP COLUMN "ventaId";
ALTER TABLE "ReporteAbono" DROP COLUMN "pagoVentaId";
