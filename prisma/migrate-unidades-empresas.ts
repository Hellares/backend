import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import * as dotenv from 'dotenv';

dotenv.config();

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

/**
 * Script para activar unidades de medida populares en todas las empresas existentes
 * que aún no tienen unidades activadas
 */
async function main() {
  console.log('🚀 Iniciando migración de unidades de medida...\n');

  try {
    // 1. Obtener todas las empresas activas
    const empresas = await prisma.empresa.findMany({
      where: {
        isActive: true,
        deletedAt: null,
      },
      select: {
        id: true,
        nombre: true,
      },
    });

    console.log(`📊 Empresas encontradas: ${empresas.length}\n`);

    // 2. Obtener las 9 unidades populares
    const unidadesPopulares = await prisma.unidadMedidaMaestra.findMany({
      where: {
        esPopular: true,
        isActive: true,
      },
      orderBy: {
        orden: 'asc',
      },
    });

    console.log(`📦 Unidades populares disponibles: ${unidadesPopulares.length}\n`);

    if (unidadesPopulares.length === 0) {
      console.log('❌ No se encontraron unidades populares. Ejecuta el seed primero: npm run seed:unidades');
      return;
    }

    let empresasActualizadas = 0;
    let empresasOmitidas = 0;

    // 3. Para cada empresa, verificar si ya tiene unidades activadas
    for (const empresa of empresas) {
      const unidadesExistentes = await prisma.empresaUnidadMedida.count({
        where: {
          empresaId: empresa.id,
          isActive: true,
          deletedAt: null,
        },
      });

      if (unidadesExistentes > 0) {
        console.log(`⏭️  ${empresa.nombre}: Ya tiene ${unidadesExistentes} unidades activadas (omitiendo)`);
        empresasOmitidas++;
        continue;
      }

      // 4. Activar las unidades populares para esta empresa
      console.log(`✨ ${empresa.nombre}: Activando ${unidadesPopulares.length} unidades populares...`);

      const unidadesCreadas = [];

      for (const unidadMaestra of unidadesPopulares) {
        try {
          const unidadEmpresa = await prisma.empresaUnidadMedida.create({
            data: {
              empresaId: empresa.id,
              unidadMaestraId: unidadMaestra.id,
              orden: unidadMaestra.orden,
              isActive: true,
              isVisible: true,
            },
          });
          unidadesCreadas.push(unidadEmpresa);
        } catch (error) {
          console.log(`   ⚠️  Error activando ${unidadMaestra.nombre}: ${error.message}`);
        }
      }

      console.log(`   ✅ ${empresa.nombre}: ${unidadesCreadas.length} unidades activadas\n`);
      empresasActualizadas++;
    }

    console.log('\n📈 Resumen de migración:');
    console.log(`   • Empresas con unidades activadas: ${empresasActualizadas}`);
    console.log(`   • Empresas omitidas (ya tenían unidades): ${empresasOmitidas}`);
    console.log(`   • Total de empresas procesadas: ${empresas.length}`);
    console.log('\n✅ Migración completada exitosamente!');

  } catch (error) {
    console.error('\n❌ Error durante la migración:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main()
  .then(() => {
    console.log('\n🎉 Script finalizado');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n💥 Error fatal:', error);
    process.exit(1);
  });
