-- Separación desde el marketplace: la empresa define el adelanto que pide
-- para apartar los productos de una cotización; el cliente lo paga con Yape
-- automático al aceptar. Aditiva.

-- AlterTable
ALTER TABLE "Cotizacion" ADD COLUMN "adelantoRequerido" DECIMAL(10,2);
