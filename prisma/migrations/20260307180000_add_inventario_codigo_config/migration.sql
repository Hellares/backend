-- AlterTable: Add inventario code counter to ConfiguracionCodigos
ALTER TABLE "ConfiguracionCodigos"
ADD COLUMN "inventarioCodigo" TEXT NOT NULL DEFAULT 'INV',
ADD COLUMN "inventarioSeparador" TEXT NOT NULL DEFAULT '-',
ADD COLUMN "inventarioLongitud" INTEGER NOT NULL DEFAULT 4,
ADD COLUMN "ultimoInventario" INTEGER NOT NULL DEFAULT 0;
