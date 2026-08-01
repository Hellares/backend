-- Fecha PACTADA con el cliente ("se lo tengo para el viernes").
-- Es el compromiso, distinto de `fechaEntrega`, que es la entrega física real.
ALTER TABLE "OrdenServicio" ADD COLUMN "fechaPrometida" TIMESTAMP(3);

-- Órdenes atrasadas: se consulta "prometidas vencidas y todavía sin entregar".
CREATE INDEX "OrdenServicio_fechaPrometida_idx"
  ON "OrdenServicio" ("fechaPrometida")
  WHERE "fechaPrometida" IS NOT NULL;

-- La tabla de archivado no la maneja Prisma (el módulo de archiving copia
-- columna por columna con SQL crudo); sin esta columna, archivar una orden
-- perdería el dato en silencio.
--
-- 🔴 Condicional a propósito: la migración 20260307200000_add_archive_tables
-- figura APLICADA en _prisma_migrations pero la tabla NO existe en db_saas ni
-- en db_saas_beta (alguien la dropeó después). Un ALTER directo abortaría toda
-- esta migración y rompería el deploy.
DO $$
BEGIN
  IF to_regclass('public."OrdenServicioArchivo"') IS NOT NULL THEN
    ALTER TABLE "OrdenServicioArchivo" ADD COLUMN "fechaPrometida" TIMESTAMPTZ;
  END IF;
END $$;
