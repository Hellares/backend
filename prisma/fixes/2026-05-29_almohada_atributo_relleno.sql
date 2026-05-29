-- ============================================================================
-- Agregar la dimensión RELLENO (CON RELLENO / SIN RELLENO) al producto
-- ALMOHADA y expandir la matriz de variantes (db_saas_beta).
--
-- Empresa : cmopb5rkv000701nweavtybvt
-- Producto: ALMOHADA (cmpnsw0v5000y01nqo21m6vqw)
-- Sede    : cmopb5ro0000c01nwcpizvmuc (Sede Principal)
--
-- Estado previo: 2 variantes con atributo Color (AZUL S/35 stk18, ROJA S/50 stk6),
--                ambas consideradas CON RELLENO.
-- Estado final : matriz 2 colores × 2 rellenos = 4 variantes:
--   AZUL CON RELLENO  S/35.00  stk 18   (existente, renombrada)
--   ROJA CON RELLENO  S/50.00  stk 6    (existente, renombrada)
--   AZUL SIN RELLENO  S/17.50  stk 18   (nueva, funda = 50% precio)
--   ROJA SIN RELLENO  S/25.00  stk 6    (nueva, funda = 50% precio)
--
-- Idempotente: ON CONFLICT en todas las inserciones.
-- ============================================================================

BEGIN;

-- 1) Atributo Relleno (SELECT con 2 valores)
INSERT INTO "ProductoAtributo" (
  id, "empresaId", "categoriaIds", nombre, clave, tipo, requerido,
  descripcion, valores, orden,
  "mostrarEnListado", "usarParaFiltros", "mostrarEnMarketplace",
  "isActive", "creadoEn", "actualizadoEn"
)
VALUES (
  'attrrellenoalmo00000000001', 'cmopb5rkv000701nweavtybvt', '{}',
  'Relleno', 'relleno', 'SELECT', false,
  NULL, ARRAY['CON RELLENO', 'SIN RELLENO'], 2,
  true, true, true,
  true, now(), now()
)
ON CONFLICT ("empresaId", clave) DO UPDATE
  SET valores = ARRAY['CON RELLENO', 'SIN RELLENO'], "actualizadoEn" = now();

-- 2) Renombrar las variantes existentes para reflejar CON RELLENO
UPDATE "ProductoVariante" SET nombre = 'AZUL CON RELLENO', "actualizadoEn" = now()
  WHERE id = 'cmpnswu09001201nqzxt8ppu6';
UPDATE "ProductoVariante" SET nombre = 'ROJA CON RELLENO', "actualizadoEn" = now()
  WHERE id = 'cmpnsy635001401nqhhcd0qv2';

-- 3) Crear las 2 variantes SIN RELLENO (funda)
INSERT INTO "ProductoVariante" (
  id, "productoId", "empresaId", nombre, sku, "codigoEmpresa",
  "isActive", orden, "creadoEn", "actualizadoEn"
)
VALUES
  ('almvarazulsr0000000000001', 'cmpnsw0v5000y01nqo21m6vqw', 'cmopb5rkv000701nweavtybvt',
   'AZUL SIN RELLENO', 'ALM-AZUL-FUNDA', 'VAR-ALM-SR-A', true, 1, now(), now()),
  ('almvarrojasr0000000000001', 'cmpnsw0v5000y01nqo21m6vqw', 'cmopb5rkv000701nweavtybvt',
   'ROJA SIN RELLENO', 'ALM-ROJA-FUNDA', 'VAR-ALM-SR-R', true, 1, now(), now())
ON CONFLICT (id) DO NOTHING;

-- 4) Stock + precio de las nuevas variantes en la sede
INSERT INTO "ProductoStock" (
  id, "sedeId", "varianteId", "empresaId", "stockActual",
  precio, "precioCosto", "precioConfigurado", "precioIncluyeIgv",
  "creadoEn", "actualizadoEn"
)
VALUES
  ('almstkazulsr00000000000001', 'cmopb5ro0000c01nwcpizvmuc', 'almvarazulsr0000000000001',
   'cmopb5rkv000701nweavtybvt', 18, 17.50, 5.00, true, true, now(), now()),
  ('almstkrojasr00000000000001', 'cmopb5ro0000c01nwcpizvmuc', 'almvarrojasr0000000000001',
   'cmopb5rkv000701nweavtybvt', 6, 25.00, 20.00, true, true, now(), now())
ON CONFLICT (id) DO NOTHING;

-- 5) Asignar RELLENO a las 4 variantes
INSERT INTO "ProductoAtributoValor" (
  id, "varianteId", "atributoId", valor, "creadoEn", "actualizadoEn"
)
SELECT
  'pavrel_' || t.vid,
  t.vid,
  (SELECT id FROM "ProductoAtributo"
     WHERE "empresaId" = 'cmopb5rkv000701nweavtybvt' AND clave = 'relleno'),
  t.val, now(), now()
FROM (VALUES
  ('cmpnswu09001201nqzxt8ppu6', 'CON RELLENO'),
  ('cmpnsy635001401nqhhcd0qv2', 'CON RELLENO'),
  ('almvarazulsr0000000000001', 'SIN RELLENO'),
  ('almvarrojasr0000000000001', 'SIN RELLENO')
) AS t(vid, val)
ON CONFLICT ("varianteId", "atributoId") DO UPDATE
  SET valor = EXCLUDED.valor, "actualizadoEn" = now();

-- 6) Asignar COLOR a las 2 variantes nuevas (las existentes ya lo tienen)
INSERT INTO "ProductoAtributoValor" (
  id, "varianteId", "atributoId", valor, "creadoEn", "actualizadoEn"
)
SELECT
  'pavcol_' || t.vid,
  t.vid,
  (SELECT id FROM "ProductoAtributo"
     WHERE "empresaId" = 'cmopb5rkv000701nweavtybvt' AND clave = 'color'),
  t.val, now(), now()
FROM (VALUES
  ('almvarazulsr0000000000001', 'AZUL'),
  ('almvarrojasr0000000000001', 'ROJA')
) AS t(vid, val)
ON CONFLICT ("varianteId", "atributoId") DO UPDATE
  SET valor = EXCLUDED.valor, "actualizadoEn" = now();

-- 7) Verificación: las 4 variantes con Color + Relleno + stock + precio
SELECT
  v.nombre AS variante,
  MAX(CASE WHEN a.clave = 'color' THEN av.valor END)   AS color,
  MAX(CASE WHEN a.clave = 'relleno' THEN av.valor END) AS relleno,
  s."stockActual" AS stock,
  s.precio
FROM "ProductoVariante" v
LEFT JOIN "ProductoAtributoValor" av ON av."varianteId" = v.id
LEFT JOIN "ProductoAtributo" a ON a.id = av."atributoId"
LEFT JOIN "ProductoStock" s ON s."varianteId" = v.id
WHERE v."productoId" = 'cmpnsw0v5000y01nqo21m6vqw' AND v."deletedAt" IS NULL
GROUP BY v.id, v.nombre, v.orden, s."stockActual", s.precio
ORDER BY v.orden, v.nombre;

COMMIT;
