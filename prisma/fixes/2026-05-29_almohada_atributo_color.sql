-- ============================================================================
-- Asignar atributo COLOR a las variantes del producto ALMOHADA (db_saas_beta).
--
-- Empresa : cmopb5rkv000701nweavtybvt
-- Producto: ALMOHADA (cmpnsw0v5000y01nqo21m6vqw)
-- Variantes:
--   AZUL  cmpnswu09001201nqzxt8ppu6  -> Color = AZUL
--   ROJA  cmpnsy635001401nqhhcd0qv2  -> Color = ROJA
--
-- Las variantes existían sin atributos estructurados (atributosValores vacío),
-- por lo que el selector las agrupaba bajo el fallback sintético "Variante".
-- Al asignarles el atributo Color, el selector las agrupa como "COLOR".
--
-- Idempotente: ON CONFLICT actualiza en vez de duplicar.
-- ============================================================================

BEGIN;

WITH attr AS (
  INSERT INTO "ProductoAtributo" (
    id, "empresaId", "categoriaIds", nombre, clave, tipo, requerido,
    descripcion, valores, orden,
    "mostrarEnListado", "usarParaFiltros", "mostrarEnMarketplace",
    "isActive", "creadoEn", "actualizadoEn"
  )
  VALUES (
    'attrcoloralmoh000000000001', 'cmopb5rkv000701nweavtybvt', '{}',
    'Color', 'color', 'SELECT', false,
    NULL, ARRAY['AZUL', 'ROJA'], 1,
    true, true, true,
    true, now(), now()
  )
  ON CONFLICT ("empresaId", clave) DO UPDATE
    SET valores = ARRAY['AZUL', 'ROJA'], "actualizadoEn" = now()
  RETURNING id
),
vals AS (
  SELECT * FROM (VALUES
    ('cmpnswu09001201nqzxt8ppu6', 'AZUL'),
    ('cmpnsy635001401nqhhcd0qv2', 'ROJA')
  ) AS t("varianteId", valor)
)
INSERT INTO "ProductoAtributoValor" (
  id, "varianteId", "atributoId", valor, "creadoEn", "actualizadoEn"
)
SELECT
  'pav_' || vals."varianteId", vals."varianteId", attr.id, vals.valor, now(), now()
FROM vals CROSS JOIN attr
ON CONFLICT ("varianteId", "atributoId") DO UPDATE
  SET valor = EXCLUDED.valor, "actualizadoEn" = now();

-- Verificación: cada variante con su Color
SELECT v.nombre AS variante, a.nombre AS atributo, av.valor
FROM "ProductoAtributoValor" av
JOIN "ProductoVariante" v ON v.id = av."varianteId"
JOIN "ProductoAtributo" a ON a.id = av."atributoId"
WHERE v."productoId" = 'cmpnsw0v5000y01nqo21m6vqw'
ORDER BY v.orden;

COMMIT;
