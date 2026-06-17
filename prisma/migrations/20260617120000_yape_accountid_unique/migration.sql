-- Cada empresa de Syncronize = una cuenta en api-yape (relación 1:1).
-- Promovemos accountId de índice simple a UNIQUE para garantizar a nivel BD
-- que el webhook entrante (resuelto por account.id) mapee a una sola empresa.
-- Evita el cobro cruzado silencioso si por error de config dos empresas
-- quedaran con el mismo accountId.

-- DropIndex
DROP INDEX IF EXISTS "integracion_yape_accountId_idx";

-- CreateIndex
CREATE UNIQUE INDEX "integracion_yape_accountId_key" ON "integracion_yape"("accountId");
