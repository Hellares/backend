-- Mano de obra del lote en MovimientoStock (solo PRODUCCION_ENTRADA de
-- fabricaciones con costeo nuevo). Nullable: los movimientos previos quedan
-- null y NO deben interpretarse como mano de obra (se derivaba mal restando
-- total ponderado − insumos).

ALTER TABLE "MovimientoStock" ADD COLUMN "costoManoObra" DECIMAL(14,2);
