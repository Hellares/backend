-- Un abono reportado puede traer varias capturas (varios Yape por el limite por operacion).
ALTER TABLE "ReporteAbono" ADD COLUMN "comprobantesUrls" TEXT[] DEFAULT ARRAY[]::TEXT[];
