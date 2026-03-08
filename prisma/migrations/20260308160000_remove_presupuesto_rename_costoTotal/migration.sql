-- AlterTable: Remove presupuesto from OrdenServicio (replaced by costoTotal)
ALTER TABLE "OrdenServicio" DROP COLUMN IF EXISTS "presupuesto";

-- AlterTable: Rename presupuesto to costoTotal in HistorialOrdenServicio
ALTER TABLE "HistorialOrdenServicio" RENAME COLUMN "presupuesto" TO "costoTotal";

-- AlterTable: Update archive tables to match
ALTER TABLE "OrdenServicioArchivo" DROP COLUMN IF EXISTS "presupuesto";
ALTER TABLE "HistorialOrdenServicioArchivo" RENAME COLUMN "presupuesto" TO "costoTotal";
