-- Rubros que la app ofrecía pero el backend rechazaba.
--
-- El dropdown de `rubro_empresa.dart` listaba 14 rubros contra un enum de 10:
-- elegir Mascotas, Belleza, Oficina o Entretenimiento daba 400 en el
-- @IsEnum de CreateEmpresaDto, antes de tocar los catálogos. (El quinto roto,
-- DEPORTE, era un plural mal escrito en la app y se arregló allá.)
--
-- ⚠️ ALTER TYPE ... ADD VALUE en PostgreSQL: el valor nuevo NO se puede USAR
-- en la misma transacción que lo crea. Acá solo se agregan, así que corre
-- bien; pero si alguna vez se le suma un UPDATE que estampe uno de estos
-- valores, va en una migración APARTE.
--
-- BEFORE 'OTRO' mantiene el orden del enum igual al del schema.prisma
-- (OTRO al final), para que `migrate diff` no reporte drift.

ALTER TYPE "RubroEmpresa" ADD VALUE IF NOT EXISTS 'BELLEZA' BEFORE 'OTRO';
ALTER TYPE "RubroEmpresa" ADD VALUE IF NOT EXISTS 'MASCOTAS' BEFORE 'OTRO';
ALTER TYPE "RubroEmpresa" ADD VALUE IF NOT EXISTS 'OFICINA' BEFORE 'OTRO';
ALTER TYPE "RubroEmpresa" ADD VALUE IF NOT EXISTS 'ENTRETENIMIENTO' BEFORE 'OTRO';
