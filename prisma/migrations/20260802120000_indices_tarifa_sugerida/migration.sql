-- Índices para la tarifa sugerida por historial.
--
-- La consulta es:
--   SELECT o.monto FROM oferta_delivery o
--   JOIN delivery_local d ON d.id = o."deliveryId"
--   WHERE o.estado = 'ACEPTADA'
--     AND o."resueltoEn" > now() - interval '90 days'
--     AND lower(translate(coalesce(d.distrito,''), ...)) = $1
--   ORDER BY o."resueltoEn" DESC LIMIT 20
--
-- Escrita a mano: el .env local apunta a la base de PRODUCCIÓN, así que
-- `prisma migrate dev` no se usa acá. Se aplica con `deploy.sh migrate <env>`.

-- 1) La mitad de la condición que vive en las ofertas.
CREATE INDEX "oferta_delivery_estado_resueltoEn_idx"
  ON "oferta_delivery" ("estado", "resueltoEn");

-- 2) 🔴 Índice de EXPRESIÓN, no un índice común sobre `distrito`.
-- El filtro no compara la columna sino `lower(translate(coalesce(...)))`, y
-- Postgres solo usa un índice de expresión si la expresión indexada calza
-- EXACTAMENTE con la del WHERE. Un `CREATE INDEX ... (distrito)` a secas
-- quedaría sin usar y daría una falsa sensación de estar optimizado.
--
-- Si alguna vez se cambia la normalización en el SQL del service, hay que
-- cambiar esta expresión igual o el índice deja de aplicarse en silencio.
--
-- Prisma no modela índices de expresión, así que este no está en el schema.
-- Verificado con `migrate diff` contra un clon de beta: NO lo reporta como
-- DROP pendiente (los ignora, a diferencia del índice trigram de
-- DireccionFrecuente, que sí intenta borrar por ser sobre columna).
--
-- Ambos índices se justifican y el planner elige según el caso — medido con
-- 20 000 filas sembradas:
--   · distrito común (13 mil deliveries) → gana el de ofertas, 1.4 ms, y
--     además evita el sort porque recorre el índice en orden inverso;
--   · distrito raro (8 deliveries) → gana este de expresión, 0.5 ms.
CREATE INDEX "delivery_local_distrito_normalizado_idx"
  ON "delivery_local" (
    lower(translate(coalesce("distrito", ''), 'áéíóúÁÉÍÓÚñÑüÜ', 'aeiouAEIOUnNuU'))
  );
