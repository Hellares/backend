// import { PrismaClient } from '@prisma/client';
// import { Pool } from 'pg';
// import { PrismaPg } from '@prisma/adapter-pg';
// import 'dotenv/config';

// // Inicializar Prisma con el mismo adapter que usa el backend
// const pool = new Pool({ connectionString: process.env.DATABASE_URL });
// const adapter = new PrismaPg(pool);

// const prisma = new PrismaClient({
//   adapter,
//   log: ['error', 'warn'],
// });

// /**
//  * Script de verificación post-migración
//  *
//  * Verifica que todos los datos fueron migrados correctamente
//  * y que es seguro deprecar los campos legacy
//  */

// interface VerificationResult {
//   productosOK: number;
//   productosFallidos: Array<{
//     id: string;
//     nombre: string;
//     stockLegacy: number;
//     stockNuevo: number;
//   }>;
//   variantesOK: number;
//   variantesFallidas: Array<{
//     id: string;
//     nombre: string;
//     stockLegacy: number;
//     stockNuevo: number;
//   }>;
//   discrepancias: boolean;
// }

// async function verificarMigracion(): Promise<VerificationResult> {
//   const result: VerificationResult = {
//     productosOK: 0,
//     productosFallidos: [],
//     variantesOK: 0,
//     variantesFallidas: [],
//     discrepancias: false,
//   };

//   console.log('🔍 Verificando migración de stock...\n');

//   // ========================================
//   // VERIFICAR PRODUCTOS
//   // ========================================
//   console.log('📦 Verificando productos...');

//   const productos = await prisma.producto.findMany({
//     where: {
//       tieneVariantes: false,
//       isActive: true,
//       deletedAt: null,
//     },
//     include: {
//       stocksPorSede: true,
//     },
//   });

//   for (const producto of productos) {
//     const stockLegacy = producto.stock;
//     const stockNuevo = producto.stocksPorSede.reduce(
//       (sum, s) => sum + s.stockActual,
//       0,
//     );

//     if (stockLegacy === stockNuevo) {
//       result.productosOK++;
//     } else {
//       result.productosFallidos.push({
//         id: producto.id,
//         nombre: producto.nombre,
//         stockLegacy,
//         stockNuevo,
//       });
//       result.discrepancias = true;
//     }
//   }

//   console.log(
//     `   ✅ ${result.productosOK} productos con stock consistente`,
//   );
//   if (result.productosFallidos.length > 0) {
//     console.log(
//       `   ❌ ${result.productosFallidos.length} productos con discrepancias`,
//     );
//   }

//   // ========================================
//   // VERIFICAR VARIANTES
//   // ========================================
//   console.log('\n🎨 Verificando variantes...');

//   const variantes = await prisma.productoVariante.findMany({
//     where: {
//       isActive: true,
//       deletedAt: null,
//     },
//     include: {
//       stocksPorSede: true,
//     },
//   });

//   for (const variante of variantes) {
//     const stockLegacy = variante.stock;
//     const stockNuevo = variante.stocksPorSede.reduce(
//       (sum, s) => sum + s.stockActual,
//       0,
//     );

//     if (stockLegacy === stockNuevo) {
//       result.variantesOK++;
//     } else {
//       result.variantesFallidas.push({
//         id: variante.id,
//         nombre: variante.nombre,
//         stockLegacy,
//         stockNuevo,
//       });
//       result.discrepancias = true;
//     }
//   }

//   console.log(
//     `   ✅ ${result.variantesOK} variantes con stock consistente`,
//   );
//   if (result.variantesFallidas.length > 0) {
//     console.log(
//       `   ❌ ${result.variantesFallidas.length} variantes con discrepancias`,
//     );
//   }

//   return result;
// }

// async function main() {
//   try {
//     console.log('═══════════════════════════════════════════════════════');
//     console.log('  VERIFICACIÓN DE MIGRACIÓN DE STOCK');
//     console.log('═══════════════════════════════════════════════════════\n');

//     const result = await verificarMigracion();

//     console.log('\n═══════════════════════════════════════════════════════');
//     console.log('  RESUMEN DE VERIFICACIÓN');
//     console.log('═══════════════════════════════════════════════════════\n');

//     if (result.discrepancias) {
//       console.log('❌ SE ENCONTRARON DISCREPANCIAS\n');

//       if (result.productosFallidos.length > 0) {
//         console.log('  Productos con discrepancias:');
//         result.productosFallidos.forEach((p) => {
//           console.log(
//             `    - ${p.nombre} (ID: ${p.id}): Legacy=${p.stockLegacy}, Nuevo=${p.stockNuevo}`,
//           );
//         });
//         console.log('');
//       }

//       if (result.variantesFallidas.length > 0) {
//         console.log('  Variantes con discrepancias:');
//         result.variantesFallidas.forEach((v) => {
//           console.log(
//             `    - ${v.nombre} (ID: ${v.id}): Legacy=${v.stockLegacy}, Nuevo=${v.stockNuevo}`,
//           );
//         });
//         console.log('');
//       }

//       console.log('⚠️  NO ES SEGURO DEPRECAR LOS CAMPOS LEGACY');
//       console.log('   Revisa las discrepancias y ejecuta la migración nuevamente\n');
//     } else {
//       console.log('✅ MIGRACIÓN EXITOSA - SIN DISCREPANCIAS\n');
//       console.log(`  📦 Productos verificados:  ${result.productosOK}`);
//       console.log(`  🎨 Variantes verificadas:  ${result.variantesOK}`);
//       console.log('\n✅ ES SEGURO DEPRECAR LOS CAMPOS LEGACY\n');
//       console.log('📝 PRÓXIMOS PASOS:');
//       console.log('   1. Marcar campos legacy como @deprecated en schema.prisma');
//       console.log('   2. Actualizar servicios para usar ProductoStock');
//       console.log('   3. Generar migración de Prisma');
//       console.log('   4. Aplicar migración en producción\n');
//     }

//     console.log('═══════════════════════════════════════════════════════\n');
//   } catch (error) {
//     console.error('❌ Error durante verificación:', error);
//     process.exit(1);
//   } finally {
//     await prisma.$disconnect();
//     await pool.end();
//   }
// }

// main();
