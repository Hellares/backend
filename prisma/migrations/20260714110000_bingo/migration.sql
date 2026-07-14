-- Dinámica de BINGO: cartillas 5×5 vendidas por el bot (misma compra en
-- bloque que los tickets), bolillas cantadas en el sorteo y detección
-- automática de LÍNEA/BINGO.
ALTER TYPE "TipoSorteo" ADD VALUE IF NOT EXISTS 'BINGO';

ALTER TABLE "Sorteo" ADD COLUMN "bolillas" JSONB;
ALTER TABLE "SorteoParticipante" ADD COLUMN "cartilla" JSONB;
ALTER TABLE "SorteoParticipante" ADD COLUMN "bingoLogros" JSONB;
