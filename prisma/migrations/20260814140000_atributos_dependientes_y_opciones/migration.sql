-- Atributos dependientes: FABRICANTE -> FAMILIA -> PROCESADOR.
--
-- Las opciones pasan a vivir en su propia tabla, donde cada una sabe de que
-- opcion del atributo PADRE cuelga. El padre se referencia por id y no por
-- texto, para que renombrar una opcion no huerfanice a sus hijas.
--
-- `ProductoAtributo.valores` NO se elimina: queda como espejo plano que el
-- servicio regenera desde esta tabla, asi todo lo que ya lo leia (generador de
-- combinaciones, edicion masiva, sheet de variantes, marketplace, web) sigue
-- funcionando sin cambios.

-- AlterEnum
ALTER TYPE "AtributoTipo" ADD VALUE IF NOT EXISTS 'SELECT_DEPENDIENTE';

-- AlterTable
ALTER TABLE "ProductoAtributo" ADD COLUMN IF NOT EXISTS "dependeDeAtributoId" TEXT;

-- CreateTable
CREATE TABLE IF NOT EXISTS "ProductoAtributoOpcion" (
    "id" TEXT NOT NULL,
    "atributoId" TEXT NOT NULL,
    "valor" TEXT NOT NULL,
    "padreId" TEXT,
    "orden" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductoAtributoOpcion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ProductoAtributoOpcion_atributoId_idx" ON "ProductoAtributoOpcion"("atributoId");
CREATE INDEX IF NOT EXISTS "ProductoAtributoOpcion_padreId_idx" ON "ProductoAtributoOpcion"("padreId");
CREATE UNIQUE INDEX IF NOT EXISTS "ProductoAtributoOpcion_atributoId_valor_key" ON "ProductoAtributoOpcion"("atributoId", "valor");
CREATE INDEX IF NOT EXISTS "ProductoAtributo_dependeDeAtributoId_idx" ON "ProductoAtributo"("dependeDeAtributoId");

-- AddForeignKey
-- El padre de la CADENA se suelta con SetNull: desarmar la dependencia no debe
-- borrar el atributo hijo ni los valores ya cargados en los productos.
ALTER TABLE "ProductoAtributo" ADD CONSTRAINT "ProductoAtributo_dependeDeAtributoId_fkey" FOREIGN KEY ("dependeDeAtributoId") REFERENCES "ProductoAtributo"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ProductoAtributoOpcion" ADD CONSTRAINT "ProductoAtributoOpcion_atributoId_fkey" FOREIGN KEY ("atributoId") REFERENCES "ProductoAtributo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Una OPCION borrada si se lleva a sus hijas: sin QUALCOMM no tiene sentido
-- que quede "Snapdragon 8 Gen" colgando de la nada.
ALTER TABLE "ProductoAtributoOpcion" ADD CONSTRAINT "ProductoAtributoOpcion_padreId_fkey" FOREIGN KEY ("padreId") REFERENCES "ProductoAtributoOpcion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: cada elemento del array `valores` pasa a ser una opcion raiz,
-- conservando el orden en que estaba. md5() en vez de gen_random_uuid() para
-- no depender de pgcrypto. ON CONFLICT cubre el caso de un array con el mismo
-- valor repetido, que el unique nuevo no admite.
INSERT INTO "ProductoAtributoOpcion" ("id", "atributoId", "valor", "orden", "actualizadoEn")
SELECT
    md5(random()::text || clock_timestamp()::text || a."id" || v.ord::text),
    a."id",
    v.valor,
    (v.ord - 1)::int,
    now()
FROM "ProductoAtributo" a
CROSS JOIN LATERAL unnest(a."valores") WITH ORDINALITY AS v(valor, ord)
WHERE cardinality(a."valores") > 0
ON CONFLICT ("atributoId", "valor") DO NOTHING;
