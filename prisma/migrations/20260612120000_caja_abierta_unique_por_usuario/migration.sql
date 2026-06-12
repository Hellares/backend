-- Cinturón definitivo contra apertura doble de caja operativa.
--
-- abrirCaja() valida-y-crea dentro de una transacción, pero con aislamiento
-- READ COMMITTED dos POST simultáneos del mismo usuario pueden pasar ambos
-- el findFirst antes de que el primero commitee. Este índice parcial hace
-- imposible la segunda caja ABIERTA a nivel de BD (el perdedor recibe P2002,
-- que el service traduce a 400).
--
-- Política espejada de abrirCaja(): 1 caja ABIERTA por usuario POR EMPRESA
-- (no por sede). Las Cajas Centrales (esCajaCentral=true, usuarioId NULL)
-- quedan fuera — su unicidad la cubre "Caja_central_por_sede_unique"
-- (migración 20260523120000, mismo patrón).
--
-- NOTA Prisma: los índices parciales no se pueden expresar en schema.prisma.
-- Igual que los índices GIN trigram: revisar que un futuro `migrate dev`
-- no lo marque como drift y lo dropee.
CREATE UNIQUE INDEX "Caja_usuario_abierta_unique"
ON "Caja"("empresaId", "usuarioId")
WHERE "estado" = 'ABIERTA' AND "esCajaCentral" = false;
