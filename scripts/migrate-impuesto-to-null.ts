/**
 * Migración: Limpiar impuestoPorcentaje de productos
 * null = "usa el IGV global actual". Solo se mantiene si es override intencional.
 *
 * Uso: npx ts-node scripts/migrate-impuesto-to-null.ts
 */

import 'dotenv/config';
import { Pool } from 'pg';

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  try {
    // 1. Obtener empresas con su IGV global
    const empresas = await pool.query(`
      SELECT e.id, e."razonSocial", ce."impuestoDefaultPorcentaje"
      FROM "Empresa" e
      LEFT JOIN "ConfiguracionEmpresa" ce ON ce."empresaId" = e.id
    `);

    let totalActualizados = 0;
    let totalPersonalizados = 0;

    for (const empresa of empresas.rows) {
      const igvGlobal = empresa.impuestoDefaultPorcentaje ?? 18;

      // 2. Poner null los que tienen el mismo IGV que el global
      const result = await pool.query(`
        UPDATE "Producto"
        SET "impuestoPorcentaje" = NULL, "actualizadoEn" = NOW()
        WHERE "empresaId" = $1
          AND "impuestoPorcentaje" = $2
          AND "deletedAt" IS NULL
      `, [empresa.id, igvGlobal]);

      totalActualizados += result.rowCount ?? 0;

      // 3. Contar los que quedan con IGV personalizado
      const personalizados = await pool.query(`
        SELECT COUNT(*) as count FROM "Producto"
        WHERE "empresaId" = $1
          AND "impuestoPorcentaje" IS NOT NULL
          AND "deletedAt" IS NULL
      `, [empresa.id]);

      const countPers = parseInt(personalizados.rows[0].count);
      totalPersonalizados += countPers;

      console.log(
        `Empresa ${empresa.razonSocial || empresa.id}: ` +
        `${result.rowCount} → null (eran ${igvGlobal}%), ` +
        `${countPers} con IGV personalizado (mantenidos)`
      );
    }

    console.log(`\n✅ Migración completada:`);
    console.log(`   ${totalActualizados} productos limpiados (impuestoPorcentaje → null)`);
    console.log(`   ${totalPersonalizados} productos con IGV personalizado (sin cambio)`);
  } catch (error) {
    console.error('❌ Error en migración:', error);
  } finally {
    await pool.end();
  }
}

main();
