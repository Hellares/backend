-- Total de operaciones GRATUITAS del comprobante (Σ referenciales sin IGV de
-- líneas convertidas por precio 0). Informativo, no suma al total.

ALTER TABLE "ComprobanteElectronico" ADD COLUMN "gratuitas" DECIMAL(10,2) NOT NULL DEFAULT 0;
