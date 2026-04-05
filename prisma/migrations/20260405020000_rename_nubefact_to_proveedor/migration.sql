-- Renombrar campos de Nubefact a nombres genéricos de proveedor

-- ConfiguracionFacturacion
ALTER TABLE "ConfiguracionFacturacion" RENAME COLUMN "nubefactRuta" TO "proveedorRuta";
ALTER TABLE "ConfiguracionFacturacion" RENAME COLUMN "nubefactToken" TO "proveedorToken";
ALTER TABLE "ConfiguracionFacturacion" RENAME COLUMN "nubefactActivo" TO "facturacionActiva";

-- ComprobanteElectronico
ALTER TABLE "ComprobanteElectronico" RENAME COLUMN "enlaceNubefact" TO "enlaceProveedor";
ALTER TABLE "ComprobanteElectronico" RENAME COLUMN "nubefactEnviado" TO "enviadoAProveedor";
ALTER TABLE "ComprobanteElectronico" RENAME COLUMN "nubefactError" TO "errorProveedor";

-- Sede
ALTER TABLE "Sede" RENAME COLUMN "nubefactRuta" TO "proveedorRuta";
ALTER TABLE "Sede" RENAME COLUMN "nubefactToken" TO "proveedorToken";
ALTER TABLE "Sede" RENAME COLUMN "nubefactActivo" TO "facturacionActiva";
