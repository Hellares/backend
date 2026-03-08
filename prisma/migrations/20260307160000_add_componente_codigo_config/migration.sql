-- AlterTable
ALTER TABLE "ConfiguracionCodigos"
ADD COLUMN "componenteCodigo" TEXT NOT NULL DEFAULT 'COMP',
ADD COLUMN "componenteSeparador" TEXT NOT NULL DEFAULT '-',
ADD COLUMN "componenteLongitud" INTEGER NOT NULL DEFAULT 5,
ADD COLUMN "ultimoComponente" INTEGER NOT NULL DEFAULT 0;
