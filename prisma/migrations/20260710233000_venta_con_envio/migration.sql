-- Ventas CON ENVÍO (pedidos por teléfono/WhatsApp despachados por
-- agencia): flag en Venta + datos del rótulo en VentaEnvio.

ALTER TABLE "Venta" ADD COLUMN "conEnvio" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "VentaEnvio" (
    "id" TEXT NOT NULL,
    "ventaId" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "destinatarioNombre" TEXT NOT NULL,
    "destinatarioDni" TEXT,
    "destinatarioCelular" TEXT,
    "agenciaNombre" TEXT,
    "destinoDepartamento" TEXT,
    "destinoProvincia" TEXT,
    "agenciaDireccion" TEXT,
    "rotuloImpresoEn" TIMESTAMP(3),
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VentaEnvio_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "VentaEnvio_ventaId_key" ON "VentaEnvio"("ventaId");
CREATE INDEX "VentaEnvio_empresaId_idx" ON "VentaEnvio"("empresaId");

ALTER TABLE "VentaEnvio" ADD CONSTRAINT "VentaEnvio_ventaId_fkey"
    FOREIGN KEY ("ventaId") REFERENCES "Venta"("id") ON DELETE CASCADE ON UPDATE CASCADE;
