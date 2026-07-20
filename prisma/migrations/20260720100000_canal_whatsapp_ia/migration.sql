-- Canal propio para las ventas del agente IA por WhatsApp (antes usaban
-- ONLINE y en el app salían con el chip de Marketplace). Aditivo.
ALTER TYPE "CanalVenta" ADD VALUE IF NOT EXISTS 'WHATSAPP_IA';
