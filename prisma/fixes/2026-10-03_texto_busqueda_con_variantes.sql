-- 03-10-2026 · Rehacer Producto.textoBusqueda de los productos CON variantes
-- para que incluya los valores de sus variantes activas ("CRISTAL", "TELA"…),
-- igual que lo arma desde ahora TextoBusquedaService.
--
-- Una sola vez por ambiente, DESPUÉS de desplegar el backend que ya lo arma
-- así (las ediciones nuevas lo mantienen solas). Idempotente.
--
-- 🔴 actualizadoEn en UTC (no now() pelado): la sesión corre en America/Lima
-- y la columna es timestamp sin zona; con hora local el producto retrocede y
-- el celular no se entera por el sync diferencial.
-- 🔑 La expresión tiene que ser IGUAL a la de texto-busqueda.service.ts.

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
        WHERE c."id" = p."empresaCategoriaId"),
      (SELECT string_agg(DISTINCT x.t, ' ') FROM (
         SELECT av."valor" AS t
           FROM "ProductoVariante" v
           JOIN "ProductoAtributoValor" av ON av."varianteId" = v."id"
           JOIN "ProductoAtributo" a ON a."id" = av."atributoId"
          WHERE v."productoId" = p."id"
            AND v."deletedAt" IS NULL
            AND v."isActive" = true
            AND a."clave" <> 'diseno'
         UNION
         -- La variante SIN atributos solo tiene su nombre ("Cristal").
         SELECT v."nombre"
           FROM "ProductoVariante" v
          WHERE v."productoId" = p."id"
            AND v."deletedAt" IS NULL
            AND v."isActive" = true
            AND NOT EXISTS (SELECT 1 FROM "ProductoAtributoValor" av
                             WHERE av."varianteId" = v."id")
       ) x)
    ))),
    "actualizadoEn" = timezone('UTC', now())
WHERE EXISTS (
  SELECT 1 FROM "ProductoVariante" v
   WHERE v."productoId" = p."id" AND v."deletedAt" IS NULL
);
