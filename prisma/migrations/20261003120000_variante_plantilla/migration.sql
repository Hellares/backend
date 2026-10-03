-- CreateTable
CREATE TABLE "VariantePlantilla" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "descripcion" TEXT,
    "atributoColeccionId" TEXT NOT NULL,
    "atributoIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VariantePlantilla_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VariantePlantillaCombinacion" (
    "id" TEXT NOT NULL,
    "plantillaId" TEXT NOT NULL,
    "valores" JSONB NOT NULL,
    "precio" DECIMAL(14,6),
    "precioCosto" DECIMAL(14,6),
    "niveles" JSONB,
    "orden" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "VariantePlantillaCombinacion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "VariantePlantilla_empresaId_idx" ON "VariantePlantilla"("empresaId");

-- CreateIndex
CREATE UNIQUE INDEX "VariantePlantilla_empresaId_nombre_key" ON "VariantePlantilla"("empresaId", "nombre");

-- CreateIndex
CREATE INDEX "VariantePlantillaCombinacion_plantillaId_idx" ON "VariantePlantillaCombinacion"("plantillaId");

-- AddForeignKey
ALTER TABLE "VariantePlantilla" ADD CONSTRAINT "VariantePlantilla_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VariantePlantillaCombinacion" ADD CONSTRAINT "VariantePlantillaCombinacion_plantillaId_fkey" FOREIGN KEY ("plantillaId") REFERENCES "VariantePlantilla"("id") ON DELETE CASCADE ON UPDATE CASCADE;
