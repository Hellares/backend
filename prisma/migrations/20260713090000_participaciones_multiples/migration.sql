-- Un DNI puede participar varias veces en el mismo sorteo.
-- DropIndex
DROP INDEX "SorteoParticipante_sorteoId_dni_key";

-- CreateIndex
CREATE INDEX "SorteoParticipante_sorteoId_dni_idx" ON "SorteoParticipante"("sorteoId", "dni");

-- AlterTable: el premio se amarra a la participación que lo originó.
ALTER TABLE "SorteoPremio" ADD COLUMN "participanteId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "SorteoPremio_participanteId_key" ON "SorteoPremio"("participanteId");
