-- Premio en EFECTIVO 💸: se yapea al ganador en vez de enviarlo por
-- agencia. El bot le pide confirmar su número de abono al ganar.
ALTER TABLE "SorteoPremioCatalogo" ADD COLUMN "esEfectivo" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "SorteoPremio" ADD COLUMN "esEfectivo" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "SorteoPremio" ADD COLUMN "abonoNumero" TEXT;
