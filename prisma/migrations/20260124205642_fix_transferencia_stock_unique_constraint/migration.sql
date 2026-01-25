-- FixTransferenciaStockUniqueConstraint
-- Cambia el constraint UNIQUE de código global a código único por empresa

-- 1. Eliminar el constraint único en 'codigo' (si existe)
-- Primero buscar el nombre del constraint
DO $$
DECLARE
    constraint_name TEXT;
BEGIN
    -- Buscar el nombre del constraint UNIQUE en la columna 'codigo'
    SELECT conname INTO constraint_name
    FROM pg_constraint
    WHERE conrelid = '"TransferenciaStock"'::regclass
    AND contype = 'u'
    AND array_length(conkey, 1) = 1
    AND conkey[1] = (
        SELECT attnum
        FROM pg_attribute
        WHERE attrelid = '"TransferenciaStock"'::regclass
        AND attname = 'codigo'
    );

    -- Si existe, eliminarlo
    IF constraint_name IS NOT NULL THEN
        EXECUTE format('ALTER TABLE "TransferenciaStock" DROP CONSTRAINT %I', constraint_name);
        RAISE NOTICE 'Constraint % eliminado exitosamente', constraint_name;
    ELSE
        RAISE NOTICE 'No se encontró constraint UNIQUE en codigo';
    END IF;
END $$;

-- 2. Eliminar el índice en 'codigo' (si existe)
DROP INDEX IF EXISTS "TransferenciaStock_codigo_key";
DROP INDEX IF EXISTS "TransferenciaStock_codigo_idx";

-- 3. Crear el nuevo constraint UNIQUE compuesto (empresaId, codigo)
ALTER TABLE "TransferenciaStock"
ADD CONSTRAINT "TransferenciaStock_empresaId_codigo_key"
UNIQUE ("empresaId", "codigo");

-- 4. Crear índice para búsquedas rápidas por código
CREATE INDEX "TransferenciaStock_codigo_idx" ON "TransferenciaStock"("codigo");
