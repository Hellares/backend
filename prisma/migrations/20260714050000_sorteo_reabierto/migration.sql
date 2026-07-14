-- Reapertura de sorteos/dinámicas para regularizar participantes: el
-- flag marca los reabiertos y el bot de WhatsApp los ignora por completo.
ALTER TABLE "Sorteo" ADD COLUMN "reabierto" BOOLEAN NOT NULL DEFAULT false;
