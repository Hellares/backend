-- Destino del premio desglosado: departamento + provincia + dirección de
-- la agencia (reemplaza el campo único agenciaSede; solo existe en beta
-- con data de prueba — se copia lo que hubiera a la dirección).

ALTER TABLE "SorteoPremio" ADD COLUMN "destinoDepartamento" TEXT;
ALTER TABLE "SorteoPremio" ADD COLUMN "destinoProvincia" TEXT;
ALTER TABLE "SorteoPremio" ADD COLUMN "agenciaDireccion" TEXT;

UPDATE "SorteoPremio" SET "agenciaDireccion" = "agenciaSede";

ALTER TABLE "SorteoPremio" DROP COLUMN "agenciaSede";
