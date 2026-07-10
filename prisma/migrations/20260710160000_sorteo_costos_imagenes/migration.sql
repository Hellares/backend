-- Sorteos: economía (precio de participación + monto por ganador) e
-- imagen promocional (EntidadTipo SORTEO para Archivo polimórfico).

ALTER TYPE "EntidadTipo" ADD VALUE 'SORTEO';

ALTER TABLE "Sorteo" ADD COLUMN "precioParticipacion" DECIMAL(14,2);
ALTER TABLE "SorteoPremio" ADD COLUMN "montoParticipacion" DECIMAL(14,2);
