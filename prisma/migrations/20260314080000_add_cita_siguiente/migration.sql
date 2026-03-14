ALTER TABLE "Cita" ADD COLUMN "siguienteCitaId" TEXT;
CREATE UNIQUE INDEX "Cita_siguienteCitaId_key" ON "Cita"("siguienteCitaId");
ALTER TABLE "Cita" ADD CONSTRAINT "Cita_siguienteCitaId_fkey" FOREIGN KEY ("siguienteCitaId") REFERENCES "Cita"("id") ON DELETE SET NULL ON UPDATE CASCADE;
