-- Búsqueda unificada de productos.
--
-- Antes: la búsqueda metía la FRASE ENTERA como un substring contra nombre,
-- descripción y código, y ni siquiera miraba la marca. "lavadora samsung"
-- devolvía CERO (una palabra está en el nombre, la otra en la marca) y
-- "samsung" solo tampoco encontraba nada.
--
-- Ahora `textoBusqueda` concentra todo eso ya normalizado, y la consulta se
-- parte en palabras exigiendo que todas aparezcan en esta columna.

-- unaccent normaliza tildes mejor que un translate con lista fija (cubre
-- también ç, ã y demás). pg_trgm ya estaba habilitado.
CREATE EXTENSION IF NOT EXISTS unaccent;

ALTER TABLE "Producto" ADD COLUMN IF NOT EXISTS "textoBusqueda" TEXT;

-- Relleno inicial. MISMA expresión que `TextoBusquedaService.sentencia()`:
-- si se toca una hay que tocar la otra o la búsqueda deja de matchear.
-- El nombre de marca/categoría no es un campo, es
-- nombreLocal ?? nombrePersonalizado ?? maestra.nombre.
UPDATE "Producto" p
SET "textoBusqueda" = lower(unaccent(concat_ws(' ',
      p."nombre",
      p."descripcion",
      p."codigoEmpresa",
      p."sku",
      p."codigoBarras",
      (SELECT coalesce(m."nombreLocal", m."nombrePersonalizado", mm."nombre")
         FROM "EmpresaMarca" m
         LEFT JOIN "MarcaMaestra" mm ON mm."id" = m."marcaMaestraId"
        WHERE m."id" = p."empresaMarcaId"),
      (SELECT coalesce(c."nombreLocal", c."nombrePersonalizado", cm."nombre")
         FROM "EmpresaCategoria" c
         LEFT JOIN "CategoriaMaestra" cm ON cm."id" = c."categoriaMaestraId"
        WHERE c."id" = p."empresaCategoriaId")
    )));

-- ⚠️ GIN trigram: Prisma NO lo modela, así que vive solo acá y `migrate diff`
-- lo va a reportar como DROP pendiente — igual que el trigram de
-- DireccionFrecuente. NO aceptarle ese DROP.
CREATE INDEX IF NOT EXISTS "Producto_textoBusqueda_trgm_idx"
  ON "Producto" USING GIN ("textoBusqueda" gin_trgm_ops);
