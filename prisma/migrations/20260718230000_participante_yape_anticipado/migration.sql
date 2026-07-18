-- "Yape en el aire": el cliente declaró que YA yapeó antes de
-- registrarse (opción 3 del bot). Habilita la sugerencia con pagos
-- anteriores al registro; nunca auto-valida.
ALTER TABLE "SorteoParticipante" ADD COLUMN "yapeAnticipadoEn" TIMESTAMP(3);
