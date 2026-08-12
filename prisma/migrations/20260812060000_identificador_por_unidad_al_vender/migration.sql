-- Identificador por unidad capturado AL VENDER (IMEI, N° de serie, placa).
--
-- Un celular se registra genérico ("CELULAR REDMI 15 PRO") pero cada unidad
-- física tiene un IMEI que tiene que salir en la boleta. Modelarlo como
-- variante obligaría a crear una variante por aparato.
--
-- El inventario NO se serializa: el stock sigue siendo genérico y el dato se
-- tipea recién al vender.
--
-- Escrita a mano y no con `prisma migrate dev` a propósito: la autogeneración
-- dropea como drift los índices GIN que no entiende.

-- Producto: qué productos piden identificador y cómo se llama.
ALTER TABLE "Producto"
  ADD COLUMN "requiereIdentificador" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "etiquetaIdentificador" VARCHAR(30);

-- VentaDetalle: un identificador por unidad vendida en esa línea.
ALTER TABLE "VentaDetalle"
  ADD COLUMN "identificadores" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- Buscar por IMEI/serie cuando llega un reclamo de garantía: "¿a quién le
-- vendí el 351234567890123?". Sin el índice es un Seq Scan sobre todas las
-- líneas de venta de la historia.
CREATE INDEX IF NOT EXISTS "VentaDetalle_identificadores_idx"
  ON "VentaDetalle" USING GIN ("identificadores");
