-- Orden: sede, adelanto, metodo
SELECT o.id, o.codigo, o.estado, o."sedeId", o."costoTotal", o.adelanto, o."metodoPagoAdelanto", o."creadoEn"
FROM "OrdenServicio" o WHERE o.codigo = 'OS-00000009';

-- Movimientos de caja vinculados a la orden
SELECT mc.id, mc.tipo, mc.categoria, mc."metodoPago", mc.monto, mc.descripcion, mc."cajaId", c.codigo AS caja_codigo, c."esCajaCentral", c.estado AS caja_estado
FROM "MovimientoCaja" mc
JOIN "Caja" c ON c.id = mc."cajaId"
WHERE mc."ordenServicioId" = (SELECT id FROM "OrdenServicio" WHERE codigo = 'OS-00000009');

-- Cualquier movimiento ADELANTO_SERVICIO reciente (por si quedó sin FK)
SELECT mc.tipo, mc.categoria, mc."metodoPago", mc.monto, mc.descripcion, mc."creadoEn", c.codigo AS caja_codigo, c."esCajaCentral"
FROM "MovimientoCaja" mc JOIN "Caja" c ON c.id = mc."cajaId"
WHERE mc.categoria = 'ADELANTO_SERVICIO'
ORDER BY mc."creadoEn" DESC LIMIT 5;

-- Cajas abiertas en la empresa de la orden
SELECT c.codigo, c.estado, c."esCajaCentral", c."sedeId", u.email
FROM "Caja" c LEFT JOIN "Usuario" u ON u.id = c."usuarioId"
WHERE c."empresaId" = (SELECT "empresaId" FROM "OrdenServicio" WHERE codigo = 'OS-00000009')
  AND c.estado = 'ABIERTA';
