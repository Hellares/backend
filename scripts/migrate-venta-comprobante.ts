/**
 * Migración: Vincular ComprobanteElectronico con Venta existentes
 * Usa: npx ts-node scripts/migrate-venta-comprobante.ts
 */
import 'dotenv/config';
import { Pool } from 'pg';

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  try {
    // Buscar comprobantes sin ventaId
    const comprobantes = await pool.query(`
      SELECT ce.id, ce."empresaId", ce."clienteId", ce.total, ce."fechaEmision", ce."tipoComprobante"
      FROM "ComprobanteElectronico" ce
      WHERE ce."ventaId" IS NULL
      ORDER BY ce."fechaEmision" DESC
    `);

    console.log(`Comprobantes sin vincular: ${comprobantes.rows.length}`);
    let vinculados = 0;
    let ambiguos = 0;

    for (const ce of comprobantes.rows) {
      // Buscar venta que coincida: misma empresa, mismo cliente, mismo total, misma fecha (±1 día)
      const fecha = new Date(ce.fechaEmision);
      const fechaInicio = new Date(fecha.getTime() - 24 * 3600000);
      const fechaFin = new Date(fecha.getTime() + 24 * 3600000);

      const ventas = await pool.query(`
        SELECT v.id, v.codigo
        FROM "Venta" v
        LEFT JOIN "ComprobanteElectronico" ce2 ON ce2."ventaId" = v.id
        WHERE v."empresaId" = $1
          AND v."clienteId" = $2
          AND v.total = $3
          AND v."fechaVenta" >= $4
          AND v."fechaVenta" <= $5
          AND v.estado != 'ANULADA'
          AND ce2.id IS NULL
      `, [ce.empresaId, ce.clienteId, ce.total, fechaInicio, fechaFin]);

      if (ventas.rows.length === 1) {
        // Match único — vincular
        await pool.query(
          'UPDATE "ComprobanteElectronico" SET "ventaId" = $1 WHERE id = $2',
          [ventas.rows[0].id, ce.id]
        );
        vinculados++;
        console.log(`  ✅ ${ce.tipoComprobante} → ${ventas.rows[0].codigo}`);
      } else if (ventas.rows.length > 1) {
        ambiguos++;
        console.log(`  ⚠️ Ambiguo: ${ce.tipoComprobante} total=${ce.total} fecha=${ce.fechaEmision} (${ventas.rows.length} ventas coinciden)`);
      }
    }

    console.log(`\n✅ Migración completada:`);
    console.log(`   ${vinculados} comprobantes vinculados`);
    console.log(`   ${ambiguos} ambiguos (requieren revisión manual)`);
    console.log(`   ${comprobantes.rows.length - vinculados - ambiguos} sin match`);
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await pool.end();
  }
}

main();
