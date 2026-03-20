-- AlterTable
ALTER TABLE "Venta" ADD COLUMN "cajeroId" TEXT;

-- CreateIndex
CREATE INDEX "Venta_cajeroId_idx" ON "Venta"("cajeroId");

-- AddForeignKey
ALTER TABLE "Venta" ADD CONSTRAINT "Venta_cajeroId_fkey" FOREIGN KEY ("cajeroId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;
