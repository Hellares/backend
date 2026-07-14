-- Quién hará el Yape si NO es el propio participante (el bot lo pregunta
-- tras las instrucciones de pago; null = paga él mismo). La empresa lo ve
-- al validar para cuadrar la notificación de Yape.
ALTER TABLE "SorteoParticipante" ADD COLUMN "pagadorNombre" TEXT;
ALTER TABLE "SorteoParticipante" ADD COLUMN "pagadorCelular" TEXT;
