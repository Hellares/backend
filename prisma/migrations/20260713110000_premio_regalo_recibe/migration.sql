-- REGALO: quien recibe el premio cuando no es el propio jugador.
-- AlterTable
ALTER TABLE "SorteoParticipante" ADD COLUMN "recibeNombre" TEXT,
ADD COLUMN "recibeDni" TEXT;

-- AlterTable
ALTER TABLE "SorteoPremio" ADD COLUMN "recibeNombre" TEXT,
ADD COLUMN "recibeDni" TEXT;
