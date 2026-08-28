-- Los 22 contadores de códigos pasan de ser columnas de UNA fila a tener una
-- fila propia por (empresa, tipo).
--
-- EL PROBLEMA: `ConfiguracionCodigos` es una sola fila por empresa que guarda
-- `ultimaVenta`, `ultimaCompra`, `ultimaCotizacion`, `ultimoProducto` y 18 más
-- como columnas del MISMO registro. Postgres bloquea la FILA hasta el commit,
-- así que el `UPDATE ultimaCompra + 1` de una recepción de compra bloqueaba el
-- `UPDATE ultimaVenta + 1` de una venta: el mostrador quedaba esperando a que
-- terminara la compra, con su conexión del pool tomada (pool = 20, compartido
-- por TODOS los tenants). Con una fila por tipo, cada flujo hace cola solo
-- consigo mismo.
--
-- Lo que esto NO cambia: el contador se sigue incrementando dentro de la
-- transacción del documento, porque soltarlo antes del commit dejaría huecos
-- en la numeración cuando una venta falla. Dos ventas de la misma empresa se
-- siguen turnando; una compra y una venta ya no.
--
-- Los 7 contadores de `Sede` (`ultimoNumeroFactura`, `ultimoNumeroBoleta`…) NO
-- se tocan: son los correlativos fiscales de SUNAT, tienen que ser sin huecos
-- y ya están bloqueados por sede con FOR UPDATE.
--
-- ADITIVA: las columnas `ultimo*` de `ConfiguracionCodigos` quedan en su lugar,
-- sin uso. No se dropean a propósito, para que un rollback de la imagen a la
-- versión anterior siga encontrando sus contadores. Ojo: tras un rollback hay
-- que copiar los valores de vuelta (ver DEPLOY_BETA_PROD.md), porque el código
-- nuevo ya no las actualiza y quedarían atrasadas.
--
-- Escrita a mano y NO con `prisma migrate dev`: ese comando dropea los índices
-- GIN trigram creados con SQL crudo.

-- CreateTable
CREATE TABLE "ContadorCodigo" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "tipo" VARCHAR(40) NOT NULL,
    "valor" INTEGER NOT NULL DEFAULT 0,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContadorCodigo_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ContadorCodigo_empresaId_tipo_key" ON "ContadorCodigo"("empresaId", "tipo");

-- CreateIndex
CREATE INDEX "ContadorCodigo_empresaId_idx" ON "ContadorCodigo"("empresaId");

-- AddForeignKey
ALTER TABLE "ContadorCodigo" ADD CONSTRAINT "ContadorCodigo_empresaId_fkey"
    FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: una fila por contador y empresa, con el valor que ya tenía.
-- El id es determinístico (md5 de empresa+tipo) para que reejecutar el backfill
-- no duplique nada y para no depender de pgcrypto/gen_random_uuid.
INSERT INTO "ContadorCodigo" ("id", "empresaId", "tipo", "valor", "actualizadoEn")
SELECT
    'ctr_' || md5(c."empresaId" || ':' || t.tipo),
    c."empresaId",
    t.tipo,
    GREATEST(t.valor, 0),
    now()
FROM "ConfiguracionCodigos" c
CROSS JOIN LATERAL (VALUES
    ('PRODUCTO',             c."ultimoProducto"),
    ('SERVICIO',             c."ultimoServicio"),
    ('VARIANTE',             c."ultimaVariante"),
    ('VENTA',                c."ultimaVenta"),
    ('COMPONENTE',           c."ultimoComponente"),
    ('COTIZACION',           c."ultimaCotizacion"),
    ('ORDEN_SERVICIO',       c."ultimaOrdenServicio"),
    ('PROVEEDOR',            c."ultimoProveedor"),
    ('TRANSFERENCIA',        c."ultimaTransferencia"),
    ('ORDEN_COMPRA',         c."ultimaOrdenCompra"),
    ('COMPRA',               c."ultimaCompra"),
    ('LOTE',                 c."ultimoLote"),
    ('SEDE',                 c."ultimaSede"),
    ('REPORTE_INCIDENCIA',   c."ultimoReporteIncidencia"),
    ('INVENTARIO',           c."ultimoInventario"),
    ('CLIENTE_EMPRESA',      c."ultimoClienteEmpresa"),
    ('CITA',                 c."ultimaCita"),
    ('PEDIDO_MARKETPLACE',   c."ultimoPedidoMarketplace"),
    ('SOLICITUD_COTIZACION', c."ultimaSolicitudCotizacion"),
    ('CAJA',                 c."ultimaCaja"),
    ('RENDICION',            c."ultimaRendicion"),
    ('EMPLEADO',             c."ultimoEmpleado")
) AS t(tipo, valor)
ON CONFLICT ("empresaId", "tipo") DO NOTHING;
