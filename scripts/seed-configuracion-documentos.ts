/**
 * Script para crear ConfiguracionDocumentos y PlantillaDocumento
 * para empresas existentes que no tienen configuracion de documentos.
 *
 * Uso: npx ts-node scripts/seed-configuracion-documentos.ts
 */
import { PrismaClient, TipoDocumento, FormatoPapel } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import 'dotenv/config';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const DEFAULT_PLANTILLAS: { tipo: TipoDocumento; nombre: string }[] = [
  { tipo: TipoDocumento.COTIZACION, nombre: 'Plantilla Cotizacion' },
  { tipo: TipoDocumento.FACTURA, nombre: 'Plantilla Factura' },
  { tipo: TipoDocumento.BOLETA, nombre: 'Plantilla Boleta' },
];

async function main() {
  console.log('Buscando empresas sin configuracion de documentos...');

  const empresas = await prisma.empresa.findMany({
    where: {
      deletedAt: null,
      configuracionDocumentos: null,
    },
    include: {
      configuracionFacturacion: true,
      personalizaciones: { take: 1 },
    },
  });

  console.log(`Encontradas ${empresas.length} empresas sin configuracion.`);

  for (const empresa of empresas) {
    try {
      const facturacion = empresa.configuracionFacturacion;
      const personalizacion = empresa.personalizaciones?.[0];

      // Create config: solo marca/estilos, datos fiscales se leen dinámicamente
      const config = await prisma.configuracionDocumentos.create({
        data: {
          empresaId: empresa.id,
          logoUrl: empresa.logo ?? null,
          nombreComercial: empresa.nombre ?? null,
          colorPrimario: personalizacion?.colorPrimario ?? '#1565C0',
          colorSecundario: personalizacion?.colorSecundario ?? '#1E88E5',
          textoPiePagina:
            facturacion?.textoPiePagina ?? 'Gracias por su preferencia',
        },
      });

      // Create default templates
      for (const { tipo, nombre } of DEFAULT_PLANTILLAS) {
        await prisma.plantillaDocumento.create({
          data: {
            empresaId: empresa.id,
            configuracionDocId: config.id,
            tipoDocumento: tipo,
            formatoPapel: FormatoPapel.A4,
            nombre,
          },
        });
      }

      console.log(
        `  [OK] ${empresa.nombre} (${empresa.id}) - config + ${DEFAULT_PLANTILLAS.length} plantillas`,
      );
    } catch (error) {
      console.error(
        `  [ERROR] ${empresa.nombre} (${empresa.id}): ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  console.log('Seed completado.');
}

main()
  .catch((e) => {
    console.error('Error fatal:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
