-- ============================================================================
-- Agregar dimensión TAMAÑO (40 CM / 80 CM / 1 METRO / 2 METROS) a ALMOHADA
-- y expandir la matriz de variantes a 16 (db_saas_beta).
--
-- Empresa : cmopb5rkv000701nweavtybvt
-- Producto: ALMOHADA (cmpnsw0v5000y01nqo21m6vqw)
-- Sede    : cmopb5ro0000c01nwcpizvmuc
--
-- Previo: 4 variantes (2 colores × 2 rellenos), consideradas 40 CM.
-- Final : 2 colores × 2 rellenos × 4 tamaños = 16 variantes.
--   Precio/costo por tamaño = base × multiplicador (40CM ×1, 80CM ×1.5, 1M ×2, 2M ×3).
--   Stock de cada tamaño nuevo = mismo que su combinación base color×relleno.
--
-- Idempotente: ids deterministas + ON CONFLICT en todo.
-- ============================================================================

BEGIN;

-- 1) Atributo Tamaño
INSERT INTO "ProductoAtributo" (
  id, "empresaId", "categoriaIds", nombre, clave, tipo, requerido,
  descripcion, valores, orden,
  "mostrarEnListado", "usarParaFiltros", "mostrarEnMarketplace",
  "isActive", "creadoEn", "actualizadoEn"
)
VALUES (
  'attrtamanoalmo000000000001', 'cmopb5rkv000701nweavtybvt', '{}',
  'Tamaño', 'tamano', 'SELECT', false,
  NULL, ARRAY['40 CM', '80 CM', '1 METRO', '2 METROS'], 3,
  true, true, true,
  true, now(), now()
)
ON CONFLICT ("empresaId", clave) DO UPDATE
  SET valores = ARRAY['40 CM', '80 CM', '1 METRO', '2 METROS'], "actualizadoEn" = now();

-- Combinaciones base (las 4 variantes actuales = 40 CM)
CREATE TEMP TABLE _combos ON COMMIT DROP AS
SELECT * FROM (VALUES
  ('cmpnswu09001201nqzxt8ppu6', 'AZUL', 'CON RELLENO', 'AZ', 'CR', 35.00, 10.00, 18),
  ('cmpnsy635001401nqhhcd0qv2', 'ROJA', 'CON RELLENO', 'RO', 'CR', 50.00, 40.00, 6),
  ('almvarazulsr0000000000001', 'AZUL', 'SIN RELLENO', 'AZ', 'SR', 17.50, 5.00, 18),
  ('almvarrojasr0000000000001', 'ROJA', 'SIN RELLENO', 'RO', 'SR', 25.00, 20.00, 6)
) AS c(vid, color, relleno, ccode, rcode, precio, costo, stock);

-- Tamaños nuevos (40 CM ya es el base, no se crea variante nueva)
CREATE TEMP TABLE _sizes ON COMMIT DROP AS
SELECT * FROM (VALUES
  ('80 CM',    '80', 1.5, 10),
  ('1 METRO',  '1M', 2.0, 20),
  ('2 METROS', '2M', 3.0, 30)
) AS s(tam, scode, mult, orden);

-- 2) Renombrar las 4 existentes para reflejar 40 CM (idempotente)
UPDATE "ProductoVariante"
SET nombre = nombre || ' 40 CM', "actualizadoEn" = now()
WHERE id IN (SELECT vid FROM _combos) AND nombre NOT LIKE '%CM%' AND nombre NOT LIKE '%METRO%';

-- 3) Crear las 12 variantes nuevas (combos × tamaños nuevos)
INSERT INTO "ProductoVariante" (
  id, "productoId", "empresaId", nombre, sku, "codigoEmpresa",
  "isActive", orden, "creadoEn", "actualizadoEn"
)
SELECT
  'almv_' || c.ccode || '_' || c.rcode || '_' || s.scode,
  'cmpnsw0v5000y01nqo21m6vqw', 'cmopb5rkv000701nweavtybvt',
  c.color || ' ' || c.relleno || ' ' || s.tam,
  'ALM-' || c.ccode || '-' || c.rcode || '-' || s.scode,
  'VAR-ALM-' || c.ccode || '-' || c.rcode || '-' || s.scode,
  true, s.orden, now(), now()
FROM _combos c CROSS JOIN _sizes s
ON CONFLICT (id) DO NOTHING;

-- 4) Stock + precio (base × multiplicador) de las 12 nuevas
INSERT INTO "ProductoStock" (
  id, "sedeId", "varianteId", "empresaId", "stockActual",
  precio, "precioCosto", "precioConfigurado", "precioIncluyeIgv",
  "creadoEn", "actualizadoEn"
)
SELECT
  'almstk_' || c.ccode || '_' || c.rcode || '_' || s.scode,
  'cmopb5ro0000c01nwcpizvmuc',
  'almv_' || c.ccode || '_' || c.rcode || '_' || s.scode,
  'cmopb5rkv000701nweavtybvt',
  c.stock,
  round((c.precio * s.mult)::numeric, 2),
  round((c.costo  * s.mult)::numeric, 2),
  true, true, now(), now()
FROM _combos c CROSS JOIN _sizes s
ON CONFLICT (id) DO NOTHING;

-- 5a) Tamaño = 40 CM para las 4 existentes
INSERT INTO "ProductoAtributoValor" (id, "varianteId", "atributoId", valor, "creadoEn", "actualizadoEn")
SELECT 'pavtam_' || c.vid, c.vid,
  (SELECT id FROM "ProductoAtributo" WHERE "empresaId" = 'cmopb5rkv000701nweavtybvt' AND clave = 'tamano'),
  '40 CM', now(), now()
FROM _combos c
ON CONFLICT ("varianteId", "atributoId") DO UPDATE SET valor = EXCLUDED.valor, "actualizadoEn" = now();

-- 5b) Color + Relleno + Tamaño para las 12 nuevas
INSERT INTO "ProductoAtributoValor" (id, "varianteId", "atributoId", valor, "creadoEn", "actualizadoEn")
SELECT 'pavcol_almv_' || c.ccode || '_' || c.rcode || '_' || s.scode,
       'almv_' || c.ccode || '_' || c.rcode || '_' || s.scode,
       (SELECT id FROM "ProductoAtributo" WHERE "empresaId" = 'cmopb5rkv000701nweavtybvt' AND clave = 'color'),
       c.color, now(), now()
FROM _combos c CROSS JOIN _sizes s
ON CONFLICT ("varianteId", "atributoId") DO UPDATE SET valor = EXCLUDED.valor, "actualizadoEn" = now();

INSERT INTO "ProductoAtributoValor" (id, "varianteId", "atributoId", valor, "creadoEn", "actualizadoEn")
SELECT 'pavrel_almv_' || c.ccode || '_' || c.rcode || '_' || s.scode,
       'almv_' || c.ccode || '_' || c.rcode || '_' || s.scode,
       (SELECT id FROM "ProductoAtributo" WHERE "empresaId" = 'cmopb5rkv000701nweavtybvt' AND clave = 'relleno'),
       c.relleno, now(), now()
FROM _combos c CROSS JOIN _sizes s
ON CONFLICT ("varianteId", "atributoId") DO UPDATE SET valor = EXCLUDED.valor, "actualizadoEn" = now();

INSERT INTO "ProductoAtributoValor" (id, "varianteId", "atributoId", valor, "creadoEn", "actualizadoEn")
SELECT 'pavtam_almv_' || c.ccode || '_' || c.rcode || '_' || s.scode,
       'almv_' || c.ccode || '_' || c.rcode || '_' || s.scode,
       (SELECT id FROM "ProductoAtributo" WHERE "empresaId" = 'cmopb5rkv000701nweavtybvt' AND clave = 'tamano'),
       s.tam, now(), now()
FROM _combos c CROSS JOIN _sizes s
ON CONFLICT ("varianteId", "atributoId") DO UPDATE SET valor = EXCLUDED.valor, "actualizadoEn" = now();

-- 6) Tocar el Producto para que el delta-sync del app baje los cambios
UPDATE "Producto" SET "actualizadoEn" = now() WHERE id = 'cmpnsw0v5000y01nqo21m6vqw';

-- 7) Verificación: las 16 variantes con sus 3 atributos + precio + stock
SELECT
  MAX(CASE WHEN a.clave = 'color'   THEN av.valor END) AS color,
  MAX(CASE WHEN a.clave = 'relleno' THEN av.valor END) AS relleno,
  MAX(CASE WHEN a.clave = 'tamano'  THEN av.valor END) AS tamano,
  s.precio, s."stockActual" AS stock
FROM "ProductoVariante" v
LEFT JOIN "ProductoAtributoValor" av ON av."varianteId" = v.id
LEFT JOIN "ProductoAtributo" a ON a.id = av."atributoId"
LEFT JOIN "ProductoStock" s ON s."varianteId" = v.id
WHERE v."productoId" = 'cmpnsw0v5000y01nqo21m6vqw' AND v."deletedAt" IS NULL
GROUP BY v.id, s.precio, s."stockActual"
ORDER BY color, relleno, s.precio;

COMMIT;
