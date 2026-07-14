-- Ciclo de vida de la rifa: ABIERTO (venta) → CERRADO (jugando) →
-- FINALIZADO (ya se sorteó todo, cierre definitivo).
ALTER TYPE "EstadoSorteo" ADD VALUE IF NOT EXISTS 'FINALIZADO';
