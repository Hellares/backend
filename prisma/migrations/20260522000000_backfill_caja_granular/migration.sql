-- Backfill Fase A: sincroniza flags legacy de caja en UsuarioSedeRol al
-- array granular `permisos`. Después de este backfill, los flags
-- `puedeAbrirCaja` / `puedeCerrarCaja` quedan funcionalmente redundantes
-- (calculatePermissions hace OR con el array y `hasGranularPermission`
-- también). Las columnas legacy se dropean en una migración futura
-- (Fase B), cuando se haya validado que nadie las lee directo.
--
-- Idempotente: el filtro `NOT 'caja.abrir' = ANY(permisos)` evita
-- duplicados si la migración corre dos veces.

UPDATE "UsuarioSedeRol"
SET permisos = array_append(permisos, 'caja.abrir')
WHERE "puedeAbrirCaja" = true
  AND NOT ('caja.abrir' = ANY(permisos))
  AND "deletedAt" IS NULL;

UPDATE "UsuarioSedeRol"
SET permisos = array_append(permisos, 'caja.cerrar')
WHERE "puedeCerrarCaja" = true
  AND NOT ('caja.cerrar' = ANY(permisos))
  AND "deletedAt" IS NULL;
