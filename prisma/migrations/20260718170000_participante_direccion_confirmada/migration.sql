-- Sello de "el CLIENTE confirmó/dio su dirección con el bot" (vs. la
-- copia silenciosa de una jugada anterior). Chip en la card del app.
ALTER TABLE "SorteoParticipante" ADD COLUMN "direccionConfirmadaEn" TIMESTAMP(3);
