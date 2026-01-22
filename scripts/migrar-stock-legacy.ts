import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import 'dotenv/config';

// Inicializar Prisma con el mismo adapter que usa el backend
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);

const prisma = new PrismaClient({
  adapter,
  log: ['error', 'warn'],
});

/**
 * Script de migración: Stock Legacy → ProductoStock
 *
 * Migra los datos de stock del sistema legacy (campos Producto.stock y ProductoVariante.stock)
 * al nuevo sistema de inventarios por sede (tabla ProductoStock).
 *
 * IMPORTANTE:
 * - Ejecutar solo una vez
 * - Hacer backup de la base de datos antes de ejecutar
 * - Revisar los resultados antes de deprecar campos legacy
 */

interface MigrationStats {
  productosConStock: number;
  variantesConStock: number;
  productosSkipped: number;
  variantesSkipped: number;
  stocksCreados: number;
  errores: Array<{ tipo: string; id: string; error: string }>;
}

async function migrarStockLegacy(): Promise<MigrationStats> {
  const stats: MigrationStats = {
    productosConStock: 0,
    variantesConStock: 0,
    productosSkipped: 0,
    variantesSkipped: 0,
    stocksCreados: 0,
    errores: [],
  };

  console.log('🚀 Iniciando migración de stock legacy a ProductoStock...\n');

  try {
    // ========================================
    // PASO 1: Migrar Productos (sin variantes)
    // ========================================
    console.log('📦 PASO 1: Migrando productos sin variantes...');

    const productos = await prisma.producto.findMany({
      where: {
        tieneVariantes: false,
        isActive: true,
        deletedAt: null,
      },
      include: {
        empresa: true,
        sede: true,
      },
    });

    console.log(`   Encontrados ${productos.length} productos sin variantes\n`);

    for (const producto of productos) {
      // Solo migrar si tiene stock > 0
      if (producto.stock <= 0) {
        stats.productosSkipped++;
        continue;
      }

      stats.productosConStock++;

      try {
        // Determinar sede: usar la sede del producto o buscar sede principal de la empresa
        let sedeId = producto.sedeId;

        if (!sedeId) {
          const sedePrincipal = await prisma.sede.findFirst({
            where: {
              empresaId: producto.empresaId,
              isActive: true,
              deletedAt: null,
            },
            orderBy: {
              creadoEn: 'asc', // Primera sede creada
            },
          });

          if (!sedePrincipal) {
            console.warn(
              `   ⚠️  Producto ${producto.id} (${producto.nombre}) no tiene sede asignada y empresa sin sedes activas. OMITIDO.`,
            );
            stats.productosSkipped++;
            continue;
          }

          sedeId = sedePrincipal.id;
          console.log(
            `   ℹ️  Producto ${producto.id} sin sede, asignado a sede principal: ${sedePrincipal.nombre}`,
          );
        }

        // Verificar si ya existe ProductoStock para este producto/sede
        const existente = await prisma.productoStock.findFirst({
          where: {
            productoId: producto.id,
            sedeId,
          },
        });

        if (existente) {
          console.log(
            `   ⏭️  Producto ${producto.id} (${producto.nombre}) ya tiene ProductoStock en sede. OMITIDO.`,
          );
          stats.productosSkipped++;
          continue;
        }

        // Crear ProductoStock
        const nuevoStock = await prisma.productoStock.create({
          data: {
            sedeId,
            empresaId: producto.empresaId,
            productoId: producto.id,
            stockActual: producto.stock,
            stockMinimo: producto.stockMinimo,
          },
        });

        stats.stocksCreados++;

        // Crear MovimientoStock inicial
        await prisma.movimientoStock.create({
          data: {
            sedeId,
            empresaId: producto.empresaId,
            productoStockId: nuevoStock.id,
            tipo: 'ENTRADA_AJUSTE',
            tipoDocumento: 'MIGRACION_LEGACY',
            numeroDocumento: `MIG-${new Date().getTime()}`,
            cantidadAnterior: 0,
            cantidad: producto.stock,
            cantidadNueva: producto.stock,
            motivo: 'Migración de stock legacy a ProductoStock',
            usuarioId: 'SISTEMA', // Marcar como migración automática
          },
        });

        console.log(
          `   ✅ Producto ${producto.id} (${producto.nombre}): ${producto.stock} unidades migradas`,
        );
      } catch (error: any) {
        stats.errores.push({
          tipo: 'producto',
          id: producto.id,
          error: error.message,
        });
        console.error(
          `   ❌ Error migrando producto ${producto.id}: ${error.message}`,
        );
      }
    }

    console.log(
      `\n   📊 Productos: ${stats.productosConStock} migrados, ${stats.productosSkipped} omitidos\n`,
    );

    // ========================================
    // PASO 2: Migrar Variantes
    // ========================================
    console.log('🎨 PASO 2: Migrando variantes de productos...');

    const variantes = await prisma.productoVariante.findMany({
      where: {
        isActive: true,
        deletedAt: null,
      },
      include: {
        producto: {
          include: {
            sede: true,
          },
        },
      },
    });

    console.log(`   Encontradas ${variantes.length} variantes\n`);

    for (const variante of variantes) {
      // Solo migrar si tiene stock > 0
      if (variante.stock <= 0) {
        stats.variantesSkipped++;
        continue;
      }

      stats.variantesConStock++;

      try {
        // Determinar sede: usar la sede del producto padre
        let sedeId = variante.producto.sedeId;

        if (!sedeId) {
          const sedePrincipal = await prisma.sede.findFirst({
            where: {
              empresaId: variante.empresaId,
              isActive: true,
              deletedAt: null,
            },
            orderBy: {
              creadoEn: 'asc',
            },
          });

          if (!sedePrincipal) {
            console.warn(
              `   ⚠️  Variante ${variante.id} (${variante.nombre}) sin sede asignada y empresa sin sedes. OMITIDO.`,
            );
            stats.variantesSkipped++;
            continue;
          }

          sedeId = sedePrincipal.id;
        }

        // Verificar si ya existe ProductoStock para esta variante/sede
        const existente = await prisma.productoStock.findFirst({
          where: {
            varianteId: variante.id,
            sedeId,
          },
        });

        if (existente) {
          console.log(
            `   ⏭️  Variante ${variante.id} (${variante.nombre}) ya tiene ProductoStock. OMITIDO.`,
          );
          stats.variantesSkipped++;
          continue;
        }

        // Crear ProductoStock
        const nuevoStock = await prisma.productoStock.create({
          data: {
            sedeId,
            empresaId: variante.empresaId,
            varianteId: variante.id,
            stockActual: variante.stock,
            stockMinimo: variante.stockMinimo,
          },
        });

        stats.stocksCreados++;

        // Crear MovimientoStock inicial
        await prisma.movimientoStock.create({
          data: {
            sedeId,
            empresaId: variante.empresaId,
            productoStockId: nuevoStock.id,
            tipo: 'ENTRADA_AJUSTE',
            tipoDocumento: 'MIGRACION_LEGACY',
            numeroDocumento: `MIG-${new Date().getTime()}`,
            cantidadAnterior: 0,
            cantidad: variante.stock,
            cantidadNueva: variante.stock,
            motivo: 'Migración de stock legacy a ProductoStock',
            usuarioId: 'SISTEMA',
          },
        });

        console.log(
          `   ✅ Variante ${variante.id} (${variante.nombre}): ${variante.stock} unidades migradas`,
        );
      } catch (error: any) {
        stats.errores.push({
          tipo: 'variante',
          id: variante.id,
          error: error.message,
        });
        console.error(
          `   ❌ Error migrando variante ${variante.id}: ${error.message}`,
        );
      }
    }

    console.log(
      `\n   📊 Variantes: ${stats.variantesConStock} migradas, ${stats.variantesSkipped} omitidas\n`,
    );
  } catch (error) {
    console.error('❌ Error crítico durante migración:', error);
    throw error;
  }

  return stats;
}

/**
 * Verificar integridad después de la migración
 */
async function verificarIntegridad(): Promise<void> {
  console.log('\n🔍 Verificando integridad de la migración...\n');

  // Verificar productos con stock > 0 pero sin ProductoStock
  const productosSinMigrar = await prisma.producto.findMany({
    where: {
      tieneVariantes: false,
      stock: { gt: 0 },
      isActive: true,
      deletedAt: null,
      stocksPorSede: {
        none: {},
      },
    },
    select: {
      id: true,
      nombre: true,
      stock: true,
    },
  });

  if (productosSinMigrar.length > 0) {
    console.warn(
      `⚠️  ADVERTENCIA: ${productosSinMigrar.length} productos con stock > 0 sin ProductoStock:`,
    );
    productosSinMigrar.forEach((p) => {
      console.warn(`   - ${p.nombre} (ID: ${p.id}, Stock: ${p.stock})`);
    });
  } else {
    console.log('✅ Todos los productos con stock tienen ProductoStock');
  }

  // Verificar variantes con stock > 0 pero sin ProductoStock
  const variantesSinMigrar = await prisma.productoVariante.findMany({
    where: {
      stock: { gt: 0 },
      isActive: true,
      deletedAt: null,
      stocksPorSede: {
        none: {},
      },
    },
    select: {
      id: true,
      nombre: true,
      stock: true,
    },
  });

  if (variantesSinMigrar.length > 0) {
    console.warn(
      `⚠️  ADVERTENCIA: ${variantesSinMigrar.length} variantes con stock > 0 sin ProductoStock:`,
    );
    variantesSinMigrar.forEach((v) => {
      console.warn(`   - ${v.nombre} (ID: ${v.id}, Stock: ${v.stock})`);
    });
  } else {
    console.log('✅ Todas las variantes con stock tienen ProductoStock');
  }

  console.log('');
}

/**
 * Función principal
 */
async function main() {
  try {
    console.log('═══════════════════════════════════════════════════════');
    console.log('  MIGRACIÓN DE STOCK LEGACY A PRODUCTOSTOCK');
    console.log('═══════════════════════════════════════════════════════\n');

    const stats = await migrarStockLegacy();

    console.log('\n═══════════════════════════════════════════════════════');
    console.log('  RESUMEN DE MIGRACIÓN');
    console.log('═══════════════════════════════════════════════════════\n');
    console.log(`  📦 Productos con stock:      ${stats.productosConStock}`);
    console.log(`  🎨 Variantes con stock:      ${stats.variantesConStock}`);
    console.log(`  ✅ ProductoStock creados:    ${stats.stocksCreados}`);
    console.log(`  ⏭️  Productos omitidos:       ${stats.productosSkipped}`);
    console.log(`  ⏭️  Variantes omitidas:       ${stats.variantesSkipped}`);
    console.log(`  ❌ Errores:                  ${stats.errores.length}`);

    if (stats.errores.length > 0) {
      console.log('\n  Errores encontrados:');
      stats.errores.forEach((err, idx) => {
        console.log(
          `    ${idx + 1}. ${err.tipo} ${err.id}: ${err.error}`,
        );
      });
    }

    console.log('\n═══════════════════════════════════════════════════════\n');

    await verificarIntegridad();

    console.log('✅ Migración completada exitosamente\n');
    console.log('📝 PRÓXIMOS PASOS:');
    console.log('   1. Revisar los resultados de la migración');
    console.log('   2. Verificar manualmente algunos ProductoStock creados');
    console.log('   3. Si todo está OK, ejecutar el script de deprecación');
    console.log('   4. Actualizar los servicios para usar ProductoStock\n');
  } catch (error) {
    console.error('❌ Error fatal:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main();
