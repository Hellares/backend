-- Quien dejo pasar mercaderia pasada de su fecha de CONSUMO PREFERENTE, y cuando.
--
-- Columna APARTE de la de bajo costo a proposito: son dos decisiones distintas,
-- y confundirlas haria que autorizar un precio bajo pareciera autorizar ademas
-- vender algo pasado de fecha.
--
-- 🔑 Se guarda AUNQUE quien vendio fuera el propio administrador. Ahi no se le
-- piden credenciales —tiene el rol— pero la decision igual queda con nombre y
-- hora: sin esto, "vendimos esto vencido y alguien lo aprobo" no se puede
-- reconstruir, que es justo lo que hay que poder mostrar si lo reclaman.
--
-- NUNCA se llena por CADUCIDAD: eso no se autoriza, se bloquea.
--
-- ADITIVA y nullable: las ventas existentes quedan en NULL.
ALTER TABLE "Venta"
  ADD COLUMN "ventaVencidaAutorizadaPorId" TEXT,
  ADD COLUMN "ventaVencidaAutorizadaEn" TIMESTAMP(3);
