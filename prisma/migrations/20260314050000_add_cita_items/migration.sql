-- CreateTable
CREATE TABLE "CitaItem" (
    "id" TEXT NOT NULL,
    "citaId" TEXT NOT NULL,
    "productoId" TEXT,
    "nombre" TEXT NOT NULL,
    "descripcion" TEXT,
    "cantidad" INTEGER NOT NULL DEFAULT 1,
    "precioUnitario" DECIMAL(10,2) NOT NULL,
    "subtotal" DECIMAL(10,2) NOT NULL,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CitaItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CitaItem_citaId_idx" ON "CitaItem"("citaId");
CREATE INDEX "CitaItem_productoId_idx" ON "CitaItem"("productoId");

-- AddForeignKey
ALTER TABLE "CitaItem" ADD CONSTRAINT "CitaItem_citaId_fkey" FOREIGN KEY ("citaId") REFERENCES "Cita"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CitaItem" ADD CONSTRAINT "CitaItem_productoId_fkey" FOREIGN KEY ("productoId") REFERENCES "Producto"("id") ON DELETE SET NULL ON UPDATE CASCADE;
