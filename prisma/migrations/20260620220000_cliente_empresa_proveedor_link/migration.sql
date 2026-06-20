-- Vínculo 1-a-1 ClienteEmpresa <-> Proveedor (mismo tercero: le compramos y le vendemos).
ALTER TABLE "ClienteEmpresa" ADD COLUMN "proveedorId" TEXT;
CREATE UNIQUE INDEX "ClienteEmpresa_proveedorId_key" ON "ClienteEmpresa"("proveedorId");
ALTER TABLE "ClienteEmpresa" ADD CONSTRAINT "ClienteEmpresa_proveedorId_fkey"
  FOREIGN KEY ("proveedorId") REFERENCES "Proveedor"("id") ON DELETE SET NULL ON UPDATE CASCADE;
