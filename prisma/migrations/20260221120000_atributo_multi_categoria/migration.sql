-- AlterTable: Convert categoriaId (single) to categoriaIds (array)
-- Step 1: Add new column categoriaIds as text array with default empty
ALTER TABLE "ProductoAtributo" ADD COLUMN "categoriaIds" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- Step 2: Migrate existing data
-- If categoriaId was non-null, set categoriaIds to array with that single value
-- If categoriaId was null, categoriaIds stays as empty array (global attribute)
UPDATE "ProductoAtributo"
SET "categoriaIds" = ARRAY["categoriaId"]
WHERE "categoriaId" IS NOT NULL;

-- Step 3: Drop the old foreign key constraint and index
ALTER TABLE "ProductoAtributo" DROP CONSTRAINT IF EXISTS "ProductoAtributo_categoriaId_fkey";
DROP INDEX IF EXISTS "ProductoAtributo_empresaId_categoriaId_idx";

-- Step 4: Drop the old column
ALTER TABLE "ProductoAtributo" DROP COLUMN "categoriaId";

-- Step 5: Remove the default (Prisma manages defaults at application level)
ALTER TABLE "ProductoAtributo" ALTER COLUMN "categoriaIds" DROP DEFAULT;
