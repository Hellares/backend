-- Vínculo PedidoMarketplace → Venta: al ENVIAR un pedido del marketplace se
-- genera una Venta interna (canal ONLINE, sin comprobante electrónico) para
-- que el pedido aparezca en reportes de ventas/kardex. Aditiva y nullable.

-- AlterTable
ALTER TABLE "PedidoMarketplace" ADD COLUMN "ventaId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "PedidoMarketplace_ventaId_key" ON "PedidoMarketplace"("ventaId");

-- AddForeignKey
ALTER TABLE "PedidoMarketplace" ADD CONSTRAINT "PedidoMarketplace_ventaId_fkey" FOREIGN KEY ("ventaId") REFERENCES "Venta"("id") ON DELETE SET NULL ON UPDATE CASCADE;
