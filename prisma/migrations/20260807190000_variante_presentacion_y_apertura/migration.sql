-- Presentación y apertura por VARIANTE (saco cerrado vs granel, fase 1).
--
-- El caso: una empresa compra 10 sacos de 15 kg y decide que 5 se venden
-- cerrados y 5 se abren para vender suelto. "150 kg" no es una sola cosa —un
-- saco cerrado y 15 kg sueltos tienen disponibilidad distinta— así que pasan
-- a ser dos VARIANTES con stock propio:
--
--     ALIMENTO PERRO ADULTO
--     ├── SACO 15KG   UND   stock 5 sacos
--     └── GRANEL      g     stock 75 000 g   presentación kg ×1000
--
-- 1) unidadPresentacionId + factorPresentacion
--    Hoy la presentación vive SOLO en Producto, así que las dos variantes
--    heredan la misma y el saco cerrado se declararía en kilos: la boleta
--    diría "1 KGM" por un saco de 15 kg. SUNAT la acepta, y miente.
--    Nullable: sin ellas la variante hereda la del producto, que es el
--    comportamiento actual de todas las variantes existentes.
--
-- 2) varianteAperturaId + rendimientoApertura
--    SACO apunta a GRANEL y dice cuánto rinde al abrirlo, en unidad de VENTA
--    del destino (15 000 si el granel se guarda en gramos). Abrir NO es una
--    conversión de vista como la presentación: mueve stock real de una
--    variante a la otra y queda en el kardex.
--
-- Las cuatro columnas son nullable y sin default: ninguna variante existente
-- cambia de comportamiento. Aditiva, el código viejo convive con el schema
-- nuevo.

ALTER TABLE "ProductoVariante"
  ADD COLUMN IF NOT EXISTS "unidadPresentacionId" TEXT,
  ADD COLUMN IF NOT EXISTS "factorPresentacion" numeric(12,4),
  ADD COLUMN IF NOT EXISTS "varianteAperturaId" TEXT,
  ADD COLUMN IF NOT EXISTS "rendimientoApertura" numeric(12,4);

-- FKs. ON DELETE SET NULL en las dos: borrar una unidad de medida o la
-- variante destino no puede llevarse puesta la variante que las referencia.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ProductoVariante_unidadPresentacionId_fkey'
  ) THEN
    ALTER TABLE "ProductoVariante"
      ADD CONSTRAINT "ProductoVariante_unidadPresentacionId_fkey"
      FOREIGN KEY ("unidadPresentacionId") REFERENCES "EmpresaUnidadMedida"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ProductoVariante_varianteAperturaId_fkey'
  ) THEN
    ALTER TABLE "ProductoVariante"
      ADD CONSTRAINT "ProductoVariante_varianteAperturaId_fkey"
      FOREIGN KEY ("varianteAperturaId") REFERENCES "ProductoVariante"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "ProductoVariante_unidadPresentacionId_idx"
  ON "ProductoVariante"("unidadPresentacionId");

CREATE INDEX IF NOT EXISTS "ProductoVariante_varianteAperturaId_idx"
  ON "ProductoVariante"("varianteAperturaId");
